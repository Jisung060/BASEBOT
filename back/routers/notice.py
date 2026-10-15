from fastapi import APIRouter, Depends, HTTPException, Query
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
        conditions.append("(n.title LIKE :keyword OR n.content LIKE :keyword)")
        params["keyword"] = f"%{keyword}%"

    if category:
        conditions.append("n.category = :category")
        params["category"] = category

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = text(f"""
        SELECT
            n.notice_id,
            n.category,
            n.title,
            n.is_pinned,
            n.view_count,
            n.created_at,
            u.nickname AS writer
        FROM notice n
        LEFT JOIN users u ON u.user_id = n.admin_id
        {where}
        ORDER BY n.is_pinned DESC, n.created_at DESC, n.notice_id DESC
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
                "created_at": row["created_at"],
                "writer": row["writer"]
            }
            for row in rows
        ]
    }


# =========================================
# 공지사항 상세 조회 (조회 수 +1)
# =========================================
@router.get("/{notice_id}")
def get_notice_detail(
        notice_id: int,
        db: Session = Depends(get_session)
):
    params = {"notice_id": notice_id}

    db.execute(
        text("UPDATE notice SET view_count = view_count + 1 WHERE notice_id = :notice_id"),
        params
    )
    db.commit()

    row = db.execute(text("""
        SELECT
            n.notice_id,
            n.category,
            n.title,
            n.content,
            n.is_pinned,
            n.view_count,
            n.created_at,
            n.updated_at,
            u.nickname AS writer
        FROM notice n
        LEFT JOIN users u ON u.user_id = n.admin_id
        WHERE n.notice_id = :notice_id
    """), params).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    return {
        "notice_id": row["notice_id"],
        "category": row["category"],
        "title": row["title"],
        "content": row["content"],
        "is_pinned": bool(row["is_pinned"]),
        "view_count": row["view_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "writer": row["writer"]
    }
