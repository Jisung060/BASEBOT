from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

router = APIRouter(
    prefix="/api/notices",
    tags=["공지사항"],
)


# =========================================
# 공지사항 목록 조회
# - 상단 고정 공지 먼저, 그다음 최신순
# - keyword: 제목/내용 검색
# - category: NOTICE(일반공지), IMPORTANT(중요공지), MAINTENANCE(점검)
# =========================================
@router.get("")
def get_notices(
        keyword: str | None = None,
        category: str | None = Query(None, pattern="^(NOTICE|IMPORTANT|MAINTENANCE)$"),
        limit: int = Query(10, ge=1, le=100),
        db: Session = Depends(get_session)
):
    conditions = []
    params = {"limit": limit}

    if keyword:
        conditions.append("(title LIKE :keyword OR content LIKE :keyword)")
        params["keyword"] = f"%{keyword}%"

    if category:
        conditions.append("category = :category")
        params["category"] = category

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = text(f"""
        SELECT
            notice_id,
            category,
            title,
            is_pinned,
            view_count,
            created_at
        FROM notice
        {where}
        ORDER BY is_pinned DESC, created_at DESC, notice_id DESC
        LIMIT :limit
    """)

    rows = db.execute(sql, params).mappings().all()

    return {
        "notices": [
            {
                "notice_id": row["notice_id"],
                "category": row["category"],
                "title": row["title"],
                "is_pinned": bool(row["is_pinned"]),
                "view_count": row["view_count"],
                "created_at": row["created_at"]
            }
            for row in rows
        ]
    }
