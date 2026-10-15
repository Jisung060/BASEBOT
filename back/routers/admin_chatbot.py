# =========================================================
# BASEBOT 관리자 - AI 챗봇 관리
# 파일: back/routers/admin_chatbot.py
# =========================================================

import jwt
import sys
import hashlib
import json
import subprocess

from datetime import datetime
from pathlib import Path

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from auth.jwt import SECRET_KEY, ALGORITHM


router = APIRouter(
    prefix="/admin/chatbot",
    tags=["Admin - Chatbot"]
)

bearer_scheme = HTTPBearer()


# =========================================================
# 관리자 인증
# =========================================================

def get_admin_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_session)
):
    """
    JWT를 검증하고 DB에서 ADMIN 권한을 확인한다.
    """

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="유효하지 않은 인증 토큰입니다."
            )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 만료되었습니다."
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 인증 토큰입니다."
        )

    user = db.execute(
        text("""
            SELECT user_id, role
            FROM users
            WHERE user_id = :user_id
        """),
        {"user_id": user_id}
    ).mappings().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다."
        )

    if user["role"] != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다."
        )

    return user


# =========================================================
# 공통 날짜 변환
# =========================================================

def serialize_datetime(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()

    return value


# =========================================================
# 1. 챗봇 통계
# GET /admin/chatbot/stats
# =========================================================

@router.get("/stats")
def get_chatbot_stats(
    admin=Depends(get_admin_user),
    db: Session = Depends(get_session)
):
    session_count = db.execute(
        text("SELECT COUNT(*) FROM chat_sessions")
    ).scalar_one()

    message_stats = db.execute(
        text("""
            SELECT
                COUNT(*) AS total_messages,
                SUM(CASE WHEN role = 'USER' THEN 1 ELSE 0 END)
                    AS user_questions,
                SUM(CASE WHEN role = 'ASSISTANT' THEN 1 ELSE 0 END)
                    AS assistant_answers
            FROM chat_messages
        """)
    ).mappings().first()

    return {
        "session_count": session_count,
        "total_messages": message_stats["total_messages"] or 0,
        "user_questions": message_stats["user_questions"] or 0,
        "assistant_answers": message_stats["assistant_answers"] or 0
    }


# =========================================================
# 2. 대화 세션 목록 및 검색
# GET /admin/chatbot/sessions
# =========================================================

@router.get("/sessions")
def get_chat_sessions(
    session_id: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None, ge=1),
    title: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin=Depends(get_admin_user),
    db: Session = Depends(get_session)
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="시작일은 종료일보다 늦을 수 없습니다."
        )

    conditions = []
    params = {
        "limit": limit,
        "offset": offset
    }

    if session_id and session_id.strip():
        conditions.append("cs.session_id LIKE :session_id")
        params["session_id"] = f"%{session_id.strip()}%"

    if user_id is not None:
        conditions.append("cs.user_id = :user_id")
        params["user_id"] = user_id

    if title and title.strip():
        conditions.append("cs.title LIKE :title")
        params["title"] = f"%{title.strip()}%"

    if start_date:
        conditions.append("cs.created_at >= :start_date")
        params["start_date"] = start_date

    if end_date:
        conditions.append(
            "cs.created_at < :end_date_exclusive"
        )
        params["end_date_exclusive"] = end_date + timedelta(days=1)

    where_clause = (
        "WHERE " + " AND ".join(conditions)
        if conditions
        else ""
    )

    total = db.execute(
        text(f"""
            SELECT COUNT(*)
            FROM chat_sessions cs
            {where_clause}
        """),
        params
    ).scalar_one()

    rows = db.execute(
        text(f"""
            SELECT
                cs.session_id,
                cs.user_id,
                cs.title,
                cs.created_at,
                COUNT(cm.message_id) AS message_count,
                MAX(cm.created_at) AS last_message_at
            FROM chat_sessions cs
            LEFT JOIN chat_messages cm
                ON cs.session_id = cm.session_id
            {where_clause}
            GROUP BY
                cs.session_id,
                cs.user_id,
                cs.title,
                cs.created_at
            ORDER BY
                COALESCE(MAX(cm.created_at), cs.created_at) DESC,
                cs.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params
    ).mappings().all()

    items = []

    for row in rows:
        items.append({
            "session_id": row["session_id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "message_count": row["message_count"],
            "last_message_at": serialize_datetime(
                row["last_message_at"]
            ),
            "created_at": serialize_datetime(
                row["created_at"]
            )
        })

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset
    }


# =========================================================
# 3. 특정 세션의 메시지 조회
# GET /admin/chatbot/sessions/{session_id}/messages
# =========================================================

@router.get("/sessions/{session_id}/messages")
def get_chat_session_messages(
    session_id: str,
    admin=Depends(get_admin_user),
    db: Session = Depends(get_session)
):
    session = db.execute(
        text("""
            SELECT
                session_id,
                user_id,
                title,
                created_at
            FROM chat_sessions
            WHERE session_id = :session_id
        """),
        {"session_id": session_id}
    ).mappings().first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="대화 세션을 찾을 수 없습니다."
        )

    messages = db.execute(
        text("""
            SELECT
                message_id,
                session_id,
                role,
                content,
                generated_sql,
                created_at
            FROM chat_messages
            WHERE session_id = :session_id
            ORDER BY created_at ASC, message_id ASC
        """),
        {"session_id": session_id}
    ).mappings().all()

    return {
        "session": {
            "session_id": session["session_id"],
            "user_id": session["user_id"],
            "title": session["title"],
            "created_at": serialize_datetime(
                session["created_at"]
            )
        },
        "messages": [
            {
                "message_id": message["message_id"],
                "role": message["role"],
                "content": message["content"],
                "generated_sql": message["generated_sql"],
                "created_at": serialize_datetime(
                    message["created_at"]
                )
            }
            for message in messages
        ]
    }


# =========================================================
# 4. 세션 삭제
# DELETE /admin/chatbot/sessions/{session_id}
# =========================================================

@router.delete("/sessions/{session_id}")
def delete_chat_session(
    session_id: str,
    admin=Depends(get_admin_user),
    db: Session = Depends(get_session)
):
    result = db.execute(
        text("""
            DELETE FROM chat_sessions
            WHERE session_id = :session_id
        """),
        {"session_id": session_id}
    )

    if result.rowcount == 0:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="삭제할 대화 세션을 찾을 수 없습니다."
        )

    # DB의 ON DELETE CASCADE가 연결된 메시지를 함께 삭제한다.
    db.commit()

    return {
        "message": "대화 세션과 연결된 메시지가 삭제되었습니다.",
        "session_id": session_id
    }


# =========================================================
# BASEBOT 관리자 - 야구 지식 문서 / RAG 관리
# 기존 admin_chatbot.py의 router와 get_admin_user 재사용
# =========================================================

PROJECT_DIR = Path(__file__).resolve().parents[2]
BACK_DIR = Path(__file__).resolve().parents[1]


def find_project_path(*relative_paths: str) -> Path:
    """
    프로젝트 루트와 back 폴더에서 대상 파일 또는 폴더를 찾는다.
    """
    bases = [PROJECT_DIR, BACK_DIR]

    for base in bases:
        for relative_path in relative_paths:
            candidate = base / relative_path

            if candidate.exists():
                return candidate.resolve()

    raise HTTPException(
        status_code=500,
        detail=f"필요한 경로를 찾을 수 없습니다: {relative_paths}"
    )


def get_rag_directory() -> Path:
    """
    rag_data 폴더 위치 확인
    """
    return find_project_path("rag_data")


def get_rag_ingest_script() -> Path:
    """
    RAG 재색인 스크립트 위치 확인
    """
    return find_project_path(
        "scripts/rag_ingest.py",
        "back/scripts/rag_ingest.py"
    )


def get_rag_manifest_path() -> Path:
    """
    마지막으로 성공한 색인 기록을 저장하는 파일.
    프로젝트 루트의 숨김 파일로 관리한다.
    """
    return PROJECT_DIR / ".rag_index_manifest.json"


def get_file_hash(file_path: Path) -> str:
    """
    문서 내용의 SHA-256 해시 계산.
    """
    digest = hashlib.sha256()

    with file_path.open("rb") as file:
        for chunk in iter(lambda: file.read(8192), b""):
            digest.update(chunk)

    return digest.hexdigest()


def load_rag_manifest() -> dict:
    """
    마지막 색인 기록 조회.
    기록 파일이 없거나 손상되었으면 빈 기록을 반환한다.
    """
    manifest_path = get_rag_manifest_path()

    if not manifest_path.exists():
        return {
            "last_indexed_at": None,
            "documents": {}
        }

    try:
        with manifest_path.open("r", encoding="utf-8") as file:
            data = json.load(file)

        if not isinstance(data, dict):
            raise ValueError("잘못된 색인 기록 형식")

        if not isinstance(data.get("documents", {}), dict):
            raise ValueError("잘못된 문서 색인 기록")

        return data

    except (OSError, json.JSONDecodeError, ValueError):
        return {
            "last_indexed_at": None,
            "documents": {}
        }


def get_document_category(relative_path: str) -> str:
    """
    파일 경로와 이름을 이용해 문서 분류를 표시한다.
    실제 파일 내용이나 파일명이 다르면 분류 규칙을 조정하면 된다.
    """
    name = Path(relative_path).stem.lower()
    parts = [part.lower() for part in Path(relative_path).parts]

    category_keywords = {
        "rules": ("rules", "rule", "규칙"),
        "terms": ("terms", "term", "용어"),
        "statistics": ("statistics", "stat", "통계", "기록"),
        "positions": ("positions", "position", "포지션"),
        "strategy": ("strategy", "전략"),
        "faq": ("faq", "자주", "질문"),
    }

    for category, keywords in category_keywords.items():
        if any(
            keyword in part
            for part in parts + [name]
            for keyword in keywords
        ):
            return category

    return "general"


def get_rag_documents() -> list[dict]:
    """
    rag_data 내 TXT 문서를 조회하고 색인 기록과 비교한다.
    """
    rag_dir = get_rag_directory()
    manifest = load_rag_manifest()
    indexed_documents = manifest.get("documents", {})

    documents = []

    for file_path in sorted(rag_dir.rglob("*.txt")):
        if not file_path.is_file():
            continue

        relative_path = file_path.relative_to(rag_dir).as_posix()
        current_hash = get_file_hash(file_path)
        previous_hash = indexed_documents.get(relative_path)

        if previous_hash == current_hash:
            index_status = "INDEXED"
        elif previous_hash:
            index_status = "PENDING"
        else:
            index_status = "NOT_INDEXED"

        stat = file_path.stat()

        documents.append({
            "filename": relative_path,
            "name": file_path.name,
            "category": get_document_category(relative_path),
            "extension": file_path.suffix.lstrip(".").upper(),
            "modified_at": datetime.fromtimestamp(
                stat.st_mtime
            ).isoformat(timespec="seconds"),
            "size_bytes": stat.st_size,
            "index_status": index_status,
        })

    return documents


# ---------------------------------------------------------
# 1. 문서 목록 조회
# GET /admin/chatbot/rag/documents
# ---------------------------------------------------------
@router.get("/rag/documents")
def list_rag_documents(
    keyword: str | None = None,
    category: str | None = None,
    admin_user=Depends(get_admin_user),
):
    documents = get_rag_documents()

    if keyword:
        keyword = keyword.strip().casefold()

        documents = [
            doc for doc in documents
            if keyword in doc["name"].casefold()
            or keyword in doc["filename"].casefold()
        ]

    if category:
        documents = [
            doc for doc in documents
            if doc["category"] == category
        ]

    return {
        "total": len(documents),
        "items": documents,
    }


# ---------------------------------------------------------
# 2. 문서 내용 조회
# GET /admin/chatbot/rag/documents/{filename}
# ---------------------------------------------------------
@router.get("/rag/documents/{filename:path}")
def get_rag_document(
    filename: str,
    admin_user=Depends(get_admin_user),
):
    rag_dir = get_rag_directory()

    # 절대 경로 및 rag_data 밖으로 나가는 경로 차단
    requested_path = (rag_dir / filename).resolve()

    if not requested_path.is_relative_to(rag_dir.resolve()):
        raise HTTPException(
            status_code=400,
            detail="잘못된 문서 경로입니다."
        )

    if (
        not requested_path.is_file()
        or requested_path.suffix.lower() != ".txt"
    ):
        raise HTTPException(
            status_code=404,
            detail="문서를 찾을 수 없습니다."
        )

    try:
        content = requested_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=422,
            detail="UTF-8 텍스트 문서만 내용을 확인할 수 있습니다."
        )
    except OSError:
        raise HTTPException(
            status_code=500,
            detail="문서를 읽는 중 오류가 발생했습니다."
        )

    return {
        "filename": requested_path.relative_to(
            rag_dir
        ).as_posix(),
        "content": content,
        "modified_at": datetime.fromtimestamp(
            requested_path.stat().st_mtime
        ).isoformat(timespec="seconds"),
    }


# ---------------------------------------------------------
# 3. 색인 상태 조회
# GET /admin/chatbot/rag/status
# ---------------------------------------------------------
@router.get("/rag/status")
def get_rag_status(
    admin_user=Depends(get_admin_user),
):
    documents = get_rag_documents()
    manifest = load_rag_manifest()

    indexed_count = sum(
        1 for doc in documents
        if doc["index_status"] == "INDEXED"
    )

    pending_count = len(documents) - indexed_count

    return {
        "total_documents": len(documents),
        "indexed_documents": indexed_count,
        "pending_documents": pending_count,
        "last_indexed_at": manifest.get("last_indexed_at"),
    }


# ---------------------------------------------------------
# 4. RAG 재색인 실행
# POST /admin/chatbot/rag/reindex
# ---------------------------------------------------------
@router.post("/rag/reindex")
def reindex_rag_documents(
    admin_user=Depends(get_admin_user),
):
    try:
        script_path = get_rag_ingest_script()
        rag_dir = get_rag_directory()

        # 재색인 대상 문서가 없는 경우 실행하지 않는다.
        source_files = [
            path for path in rag_dir.rglob("*.txt")
            if path.is_file()
        ]

        if not source_files:
            raise HTTPException(
                status_code=400,
                detail="재색인할 야구 지식 문서가 없습니다."
            )

        # shell=True를 사용하지 않고 현재 Python 환경으로 실행한다.
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(script_path.parent.parent),
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )

        if result.returncode != 0:
            # 내부 경로나 환경변수 등 민감한 정보를 그대로 노출하지 않는다.
            print("RAG 재색인 실패:")
            print(result.stderr[-4000:])

            raise HTTPException(
                status_code=500,
                detail="재색인 스크립트가 실패했습니다. 서버 로그를 확인해 주세요."
            )

        # 스크립트가 정상 종료된 후 색인 기준을 기록한다.
        # 이 기록은 스크립트의 종료 코드를 기준으로 하며,
        # Chroma 내부 데이터의 정확성을 독립적으로 검증하지는 않는다.
        manifest = {
            "last_indexed_at": datetime.now().isoformat(
                timespec="seconds"
            ),
            "documents": {
                path.relative_to(rag_dir).as_posix(): get_file_hash(path)
                for path in source_files
            },
        }

        manifest_path = get_rag_manifest_path()

        manifest_path.write_text(
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        return {
            "success": True,
            "message": "RAG 재색인이 완료되었습니다.",
            "last_indexed_at": manifest["last_indexed_at"],
        }

    except HTTPException:
        raise

    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail="재색인 실행 시간이 초과되었습니다."
        )

    except Exception:
        print("RAG 재색인 중 예기치 않은 오류가 발생했습니다.")

        raise HTTPException(
            status_code=500,
            detail="재색인 중 서버 오류가 발생했습니다."
        )