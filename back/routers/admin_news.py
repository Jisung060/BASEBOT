import json
import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from auth.jwt import decode_access_token
from database.db_connection import SessionFactory, get_session
from models.user import User
from routers import news as news_module
from datetime import datetime

router = APIRouter(prefix="/admin/news", tags=["Admin - News"])
bearer_scheme = HTTPBearer()

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
FRONT_DIR = Path(os.getenv("BASEBOT_FRONT_DIR", str(PROJECT_DIR / "front"))).resolve()
PAGE_FILE = FRONT_DIR / "pages" / "admin" / "news.html"

# ★ back/config/basebot_admin_settings.json 으로 하위 폴더 분리 및 환경변수명 변경
DEFAULT_SETTINGS_PATH = BACKEND_DIR / "config" / "basebot_admin_settings.json"
SETTINGS_FILE = Path(
    os.getenv(
        "BASEBOT_SETTINGS_FILE",
        os.getenv("MLB_NEWS_SETTINGS_FILE", str(DEFAULT_SETTINGS_PATH))
    )
).resolve()

DEFAULT_INTERVAL = max(
    60, min(int(os.getenv("MLB_NEWS_INTERVAL", "3600")), 86400)
)


def get_admin_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_session),
) -> User:
    """Use the same JWT + role authorization pattern as the other admin APIs."""
    try:
        payload = decode_access_token(credentials.credentials)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 토큰이 유효하지 않거나 만료되었습니다.",
        ) from exc

    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 로그인 정보입니다.",
        )

    user = db.scalar(select(User).where(User.user_id == user_id))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="회원 정보를 찾을 수 없습니다.",
        )
    if user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자만 접근할 수 있습니다.",
        )
    return user


def _read_settings_payload() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


def _read_interval() -> int:
    payload = _read_settings_payload()
    try:
        value = int(payload.get("interval_seconds", DEFAULT_INTERVAL))
        return max(60, min(value, 86400))
    except (ValueError, TypeError):
        return DEFAULT_INTERVAL


def _write_interval(seconds: int) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = _read_settings_payload()
    payload["interval_seconds"] = seconds
    payload["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    temp_file = SETTINGS_FILE.with_suffix(".tmp")
    temp_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_file.replace(SETTINGS_FILE)


# Apply a saved interval to the existing crawler module.
news_module.CRAWL_INTERVAL = _read_interval()


class SettingsBody(BaseModel):
    interval_minutes: int = Field(ge=1, le=1440)


class BulkDeleteBody(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=200)


@router.get("/page", include_in_schema=False)
def admin_news_page():
    # Match the existing admin pages' folder structure.
    if not PAGE_FILE.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"관리자 뉴스 페이지 파일을 찾을 수 없습니다: {PAGE_FILE}",
        )
    return FileResponse(str(PAGE_FILE), media_type="text/html")


@router.get("/settings")
def get_settings(_: User = Depends(get_admin_user)):
    seconds = int(news_module.CRAWL_INTERVAL)
    return {
        "status": "success",
        "interval_minutes": max(1, seconds // 60),
        "interval_seconds": seconds,
    }


@router.put("/settings")
def update_settings(
    body: SettingsBody,
    _: User = Depends(get_admin_user),
):
    seconds = body.interval_minutes * 60
    try:
        _write_interval(seconds)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail="뉴스 수집 설정 파일을 저장하지 못했습니다.",
        ) from exc

    news_module.CRAWL_INTERVAL = seconds
    return {
        "status": "success",
        "message": "뉴스 수집 주기를 저장했습니다.",
        "interval_minutes": body.interval_minutes,
    }


@router.post("/crawl")
def crawl_now(_: User = Depends(get_admin_user)):
    result = news_module.sync_news()
    if result.get("status") == "busy":
        raise HTTPException(
            status_code=409,
            detail="이미 뉴스 수집이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
        )
    return {
        "status": "success",
        "message": "뉴스 수집이 완료되었습니다.",
        "result": result,
    }


@router.get("")
def list_news(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    keyword: str = Query(default="", max_length=200),
    _: User = Depends(get_admin_user),
):
    db = SessionFactory()
    try:
        where = "WHERE status = 'ACTIVE'"
        params = {"limit": limit, "offset": (page - 1) * limit}
        if keyword.strip():
            where += " AND (title LIKE :keyword OR source_name LIKE :keyword)"
            params["keyword"] = f"%{keyword.strip()}%"

        total = db.execute(
            text(f"SELECT COUNT(*) FROM mlb_news {where}"), params
        ).scalar() or 0
        rows = db.execute(
            text(f"""
                SELECT news_id, source_id, source_name, title, source_url,
                       author, published_at, crawled_at, status
                FROM mlb_news
                {where}
                ORDER BY COALESCE(published_at, crawled_at) DESC, news_id DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        ).mappings().all()

        return {
            "status": "success",
            "page": page,
            "limit": limit,
            "total": total,
            "data": [dict(row) for row in rows],
        }
    finally:
        db.close()


@router.delete("/{news_id}")
def delete_news(
    news_id: int,
    _: User = Depends(get_admin_user),
):
    db = SessionFactory()
    try:
        result = db.execute(
            text("DELETE FROM mlb_news WHERE news_id = :news_id"),
            {"news_id": news_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="삭제할 기사를 찾을 수 없습니다.")
        db.commit()
        return {"status": "success", "deleted": 1}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/bulk-delete")
def bulk_delete(
    body: BulkDeleteBody,
    _: User = Depends(get_admin_user),
):
    ids = list(dict.fromkeys(body.ids))
    db = SessionFactory()
    try:
        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        params = {f"id{i}": value for i, value in enumerate(ids)}
        result = db.execute(
            text(f"DELETE FROM mlb_news WHERE news_id IN ({placeholders})"),
            params,
        )
        db.commit()
        return {"status": "success", "deleted": result.rowcount or 0}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/cleanup-non-mlb")
def cleanup_non_mlb(_: User = Depends(get_admin_user)):
    """Delete already-saved titles that the existing conservative filter flags."""
    db = SessionFactory()
    try:
        rows = db.execute(
            text("""
                SELECT news_id, title
                FROM mlb_news
                WHERE status = 'ACTIVE'
            """)
        ).mappings().all()

        ids = [
            row["news_id"]
            for row in rows
            if news_module.is_non_mlb_article(row["title"] or "")
        ]
        if not ids:
            return {"status": "success", "deleted": 0}

        placeholders = ", ".join(f":id{i}" for i in range(len(ids)))
        params = {f"id{i}": value for i, value in enumerate(ids)}
        result = db.execute(
            text(f"DELETE FROM mlb_news WHERE news_id IN ({placeholders})"),
            params,
        )
        db.commit()
        return {"status": "success", "deleted": result.rowcount or 0}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
