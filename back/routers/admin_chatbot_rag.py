from pathlib import Path
from datetime import datetime
from typing import Optional
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from database.db_connection import get_session
from routers.admin_users import get_admin_user


router = APIRouter(
    prefix="/admin/chatbot/rag",
    tags=["Admin - Chatbot RAG"],
)


# ==================================================
# 경로 설정
# back 폴더 또는 프로젝트 루트에 있는 기존 디렉터리 탐색
# ==================================================

BACK_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACK_DIR.parent


def resolve_directory(name: str, marker: Optional[str] = None) -> Path:
    candidates = [
        BACK_DIR / name,
        PROJECT_DIR / name,
        Path.cwd() / name,
        Path.cwd().parent / name,
    ]

    for path in candidates:
        if not path.is_dir():
            continue

        if marker is None:
            return path.resolve()

        if "*" in marker or "?" in marker:
            if any(path.glob(marker)):
                return path.resolve()
        elif (path / marker).exists():
            return path.resolve()

    return (BACK_DIR / name).resolve()


DATA_PATH = resolve_directory("rag_data", "*.txt")
CHROMA_PATH = resolve_directory("chroma_db", "chroma.sqlite3")

COLLECTION_NAME = "basebot"


# ==================================================
# 임베딩 요청 설정
# ==================================================

# 한 번의 임베딩 요청에 넣을 문서 조각 수
EMBEDDING_BATCH_SIZE = 10

# 요청 사이 대기 시간
# 분당 요청 횟수를 줄이기 위한 설정
EMBEDDING_BATCH_DELAY = 1.2

# 429 오류 발생 시 최대 재시도 횟수
EMBEDDING_MAX_RETRIES = 2

# 429 오류 발생 시 재시도 대기 시간
EMBEDDING_RETRY_DELAY = 65


# ==================================================
# 공통 함수
# ==================================================

def get_embeddings():
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001"
    )


def get_vectorstore():
    if not CHROMA_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Chroma 데이터베이스 경로를 찾을 수 없습니다: {CHROMA_PATH}",
        )

    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=get_embeddings(),
        persist_directory=str(CHROMA_PATH),
    )


def get_txt_files():
    if not DATA_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"RAG 문서 폴더를 찾을 수 없습니다: {DATA_PATH}",
        )

    return sorted(DATA_PATH.rglob("*.txt"))


def get_category(filename: str) -> str:
    name = Path(filename).stem.lower()

    categories = {
        "rules": ["rule", "rules", "규칙"],
        "terms": ["term", "terms", "용어"],
        "statistics": ["stat", "statistics", "기록", "통계"],
        "positions": ["position", "positions", "포지션", "수비"],
        "strategy": ["strategy", "전략", "작전"],
        "faq": ["faq", "질문", "자주묻는"],
    }

    for category, keywords in categories.items():
        if any(keyword in name for keyword in keywords):
            return category

    return "general"


def get_indexed_sources():
    try:
        vectorstore = get_vectorstore()
        result = vectorstore.get(include=["metadatas"])

        sources = set()

        for metadata in result.get("metadatas", []):
            if metadata and metadata.get("source"):
                sources.add(metadata["source"])

        return sources

    except HTTPException:
        raise

    except Exception as error:
        print("[관리자 RAG 색인 현황 조회 오류]", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Chroma 색인 현황을 조회하지 못했습니다.",
        )


def get_relative_filename(file_path: Path) -> str:
    return file_path.relative_to(DATA_PATH).as_posix()


def embed_documents_in_batches(embeddings, documents):
    """
    문서 조각을 작은 배치로 나누어 임베딩한다.

    - 한 번에 10개씩 처리
    - 배치 사이 1.2초 대기
    - 429 오류 발생 시 65초 대기 후 재시도
    - 모든 임베딩 생성이 완료되기 전에는 기존 색인을 삭제하지 않는다.
    """

    all_vectors = []

    total = len(documents)

    for start in range(0, total, EMBEDDING_BATCH_SIZE):
        batch_documents = documents[
            start:start + EMBEDDING_BATCH_SIZE
        ]

        batch_texts = [
            document.page_content
            for document in batch_documents
        ]

        batch_number = start // EMBEDDING_BATCH_SIZE + 1
        total_batches = (
            total + EMBEDDING_BATCH_SIZE - 1
        ) // EMBEDDING_BATCH_SIZE

        print(
            f"[RAG 임베딩] "
            f"{batch_number}/{total_batches} 배치 처리 중 "
            f"({len(batch_texts)}개)"
        )

        for attempt in range(EMBEDDING_MAX_RETRIES + 1):
            try:
                batch_vectors = embeddings.embed_documents(
                    batch_texts,
                    batch_size=EMBEDDING_BATCH_SIZE,
                )

                if len(batch_vectors) != len(batch_texts):
                    raise RuntimeError(
                        "임베딩 결과 개수가 입력 문서 개수와 다릅니다."
                    )

                all_vectors.extend(batch_vectors)
                break

            except Exception as error:
                error_message = str(error).upper()

                is_rate_limit = (
                    "429" in error_message
                    or "RESOURCE_EXHAUSTED" in error_message
                )

                if not is_rate_limit:
                    raise

                if attempt >= EMBEDDING_MAX_RETRIES:
                    raise RuntimeError(
                        "Gemini 임베딩 API의 사용량 한도를 초과했습니다. "
                        "잠시 기다린 후 다시 시도하거나 "
                        "Gemini API 사용량 및 할당량을 확인해 주세요."
                    ) from error

                print(
                    f"[RAG 임베딩] API 사용량 한도 초과. "
                    f"{EMBEDDING_RETRY_DELAY}초 후 재시도 "
                    f"({attempt + 1}/{EMBEDDING_MAX_RETRIES})"
                )

                time.sleep(EMBEDDING_RETRY_DELAY)

        # 마지막 배치가 아니라면 다음 요청까지 대기
        if start + EMBEDDING_BATCH_SIZE < total:
            time.sleep(EMBEDDING_BATCH_DELAY)

    return all_vectors


# ==================================================
# GET /admin/chatbot/rag/status
# 색인 현황 조회
# ==================================================

@router.get("/status")
def get_rag_status(
    admin=Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    files = get_txt_files()
    indexed_sources = get_indexed_sources()

    indexed_count = sum(
        1
        for file_path in files
        if get_relative_filename(file_path) in indexed_sources
        or file_path.name in indexed_sources
    )

    last_indexed_at = None
    sqlite_path = CHROMA_PATH / "chroma.sqlite3"

    if sqlite_path.exists():
        last_indexed_at = datetime.fromtimestamp(
            sqlite_path.stat().st_mtime
        ).isoformat()

    return {
        "total_documents": len(files),
        "indexed_documents": indexed_count,
        "pending_documents": len(files) - indexed_count,
        "last_indexed_at": last_indexed_at,
    }


# ==================================================
# GET /admin/chatbot/rag/documents
# 문서 목록 및 검색
# ==================================================

@router.get("/documents")
def get_rag_documents(
    keyword: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    admin=Depends(get_admin_user),
):
    files = get_txt_files()
    indexed_sources = get_indexed_sources()

    items = []

    for file_path in files:
        filename = get_relative_filename(file_path)
        file_category = get_category(file_path.name)

        if keyword and keyword.lower() not in file_path.name.lower():
            continue

        if category and category != file_category:
            continue

        modified_at = datetime.fromtimestamp(
            file_path.stat().st_mtime
        ).isoformat()

        is_indexed = (
            filename in indexed_sources
            or file_path.name in indexed_sources
        )

        items.append({
            "filename": filename,
            "name": file_path.name,
            "category": file_category,
            "extension": file_path.suffix,
            "modified_at": modified_at,
            "index_status": (
                "INDEXED" if is_indexed else "NOT_INDEXED"
            ),
            "size_bytes": file_path.stat().st_size,
        })

    return {"items": items}


# ==================================================
# GET /admin/chatbot/rag/documents/{filename}
# 문서 내용 조회
# ==================================================

@router.get("/documents/{filename:path}")
def get_rag_document(
    filename: str,
    admin=Depends(get_admin_user),
):
    target = (DATA_PATH / filename).resolve()

    # 폴더 밖 파일을 읽는 경로 접근 방지
    if not target.is_relative_to(DATA_PATH):
        raise HTTPException(
            status_code=400,
            detail="잘못된 문서 경로입니다.",
        )

    if not target.is_file() or target.suffix.lower() != ".txt":
        raise HTTPException(
            status_code=404,
            detail="문서를 찾을 수 없습니다.",
        )

    try:
        content = target.read_text(encoding="utf-8")

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="UTF-8 형식의 문서만 조회할 수 있습니다.",
        )

    return {
        "filename": filename,
        "content": content,
    }


# ==================================================
# POST /admin/chatbot/rag/reindex
# 전체 TXT 문서 재색인
# ==================================================

@router.post("/reindex")
def reindex_rag_documents(
    admin=Depends(get_admin_user),
):
    try:
        # ------------------------------------------
        # 1. TXT 문서 조회
        # ------------------------------------------

        files = get_txt_files()

        if not files:
            raise HTTPException(
                status_code=400,
                detail="재색인할 TXT 문서가 없습니다.",
            )

        documents = []

        for file_path in files:
            content = file_path.read_text(
                encoding="utf-8"
            )

            if not content.strip():
                continue

            documents.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": get_relative_filename(file_path),
                        "category": get_category(file_path.name),
                    },
                )
            )

        if not documents:
            raise HTTPException(
                status_code=400,
                detail="내용이 비어 있지 않은 TXT 문서가 없습니다.",
            )

        # ------------------------------------------
        # 2. 문서 분할
        # ------------------------------------------

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
        )

        split_documents = splitter.split_documents(
            documents
        )

        if not split_documents:
            raise HTTPException(
                status_code=400,
                detail="색인할 문서 조각이 없습니다.",
            )

        print(
            f"[관리자 RAG 재색인] "
            f"원본 문서: {len(documents)}개, "
            f"문서 조각: {len(split_documents)}개"
        )

        # ------------------------------------------
        # 3. 배치 단위 임베딩 생성
        #
        # 모든 임베딩이 생성될 때까지 기존 색인을
        # 삭제하거나 변경하지 않는다.
        # ------------------------------------------

        embeddings = get_embeddings()

        vectors = embed_documents_in_batches(
            embeddings,
            split_documents,
        )

        if len(vectors) != len(split_documents):
            raise RuntimeError(
                "전체 임베딩 결과 개수가 문서 조각 수와 다릅니다."
            )

        # ------------------------------------------
        # 4. Chroma 연결
        # ------------------------------------------

        vectorstore = Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=str(CHROMA_PATH),
        )

        collection = vectorstore._collection

        ids = [
            f"{document.metadata['source']}::chunk::{index}"
            for index, document in enumerate(split_documents)
        ]

        texts = [
            document.page_content
            for document in split_documents
        ]

        metadatas = [
            document.metadata
            for document in split_documents
        ]

        # ------------------------------------------
        # 5. 임베딩 생성 성공 후 기존 색인 교체
        # ------------------------------------------

        existing = collection.get()
        existing_ids = existing.get("ids", [])

        if existing_ids:
            collection.delete(ids=existing_ids)

        # Chroma 데이터 추가도 배치 단위로 처리
        chroma_batch_size = 100

        for start in range(0, len(ids), chroma_batch_size):
            end = start + chroma_batch_size

            collection.add(
                ids=ids[start:end],
                documents=texts[start:end],
                metadatas=metadatas[start:end],
                embeddings=vectors[start:end],
            )

        # ------------------------------------------
        # 6. 색인 결과 반환
        # ------------------------------------------

        sqlite_path = CHROMA_PATH / "chroma.sqlite3"

        last_indexed_at = (
            datetime.fromtimestamp(
                sqlite_path.stat().st_mtime
            ).isoformat()
            if sqlite_path.exists()
            else datetime.now().isoformat()
        )

        print(
            f"[관리자 RAG 재색인 완료] "
            f"원본 문서 {len(documents)}개, "
            f"색인 조각 {len(split_documents)}개"
        )

        return {
            "message": (
                f"RAG 재색인이 완료되었습니다. "
                f"원본 문서 {len(documents)}개, "
                f"색인 조각 {len(split_documents)}개"
            ),
            "total_documents": len(documents),
            "indexed_chunks": len(split_documents),
            "last_indexed_at": last_indexed_at,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(
            "[관리자 RAG 재색인 오류]",
            repr(error),
        )

        raise HTTPException(
            status_code=500,
            detail=f"RAG 재색인 중 오류가 발생했습니다: {str(error)}",
        )





@router.get("/chunks")
def get_rag_chunks(
    keyword: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    admin=Depends(get_admin_user),
):
    try:
        vectorstore = get_vectorstore()
        collection = vectorstore._collection

        # ChromaDB에 실제 저장된 전체 색인 조각 수
        total_count = collection.count()

        # 전체 데이터를 한 번에 가져오지 않고 500개씩 조회
        batch_size = 500
        offset = 0
        items = []

        while offset < total_count:
            current_limit = min(batch_size, total_count - offset)

            result = collection.get(
                limit=current_limit,
                offset=offset,
                include=["documents", "metadatas"],
            )

            ids = result.get("ids") or []
            documents = result.get("documents") or []
            metadatas = result.get("metadatas") or []

            # 조회 결과를 색인 조각 단위로 정리
            for index, chunk_id in enumerate(ids):
                content = (
                    documents[index]
                    if index < len(documents)
                    else None
                )

                metadata = (
                    metadatas[index] or {}
                    if index < len(metadatas)
                    else {}
                )

                if content is None:
                    continue

                chunk_source = metadata.get("source", "")
                chunk_category = metadata.get("category", "general")

                # 원본 문서 필터
                if source and chunk_source != source:
                    continue

                # 카테고리 필터
                if category and chunk_category != category:
                    continue

                # 내용 검색
                if keyword and keyword.casefold() not in content.casefold():
                    continue

                items.append({
                    "id": chunk_id,
                    "source": chunk_source,
                    "category": chunk_category,
                    "content": content,
                })

            # 다음 묶음으로 이동
            offset += len(ids)

            # 예외적으로 조회 결과가 없으면 무한 반복 방지
            if not ids:
                break

        # 검색 조건까지 적용한 전체 개수
        filtered_total = len(items)

        # 페이지네이션
        start = (page - 1) * page_size
        paginated_items = items[start:start + page_size]

        return {
            "items": paginated_items,
            "total": filtered_total,
            "collection_total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": (
                filtered_total + page_size - 1
            ) // page_size,
        }

    except HTTPException:
        raise

    except Exception as error:
        print("[관리자 RAG 색인 조각 조회 오류]", repr(error))

        raise HTTPException(
            status_code=500,
            detail="ChromaDB 색인 조각을 조회하지 못했습니다.",
        )
