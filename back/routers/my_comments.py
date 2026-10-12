
# =========================================================
# 마이페이지 - 내가 쓴 댓글
# =========================================================

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from auth.dependencies import get_current_user


router = APIRouter(
    prefix="/api/mypage",
    tags=["마이페이지"]
)


# =========================================================
# 내가 작성한 댓글 조회
# 페이지당 5개
# =========================================================

@router.get("/comments")
def get_my_comments(
    page: int = Query(default=1, ge=1),
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user)
):
    page_size = 5
    offset = (page - 1) * page_size
    user_id = current_user.user_id

    # 전체 댓글 수
    count_sql = text("""
        SELECT COUNT(*) AS total
        FROM comments
        WHERE user_id = :user_id
    """)

    total = db.execute(
        count_sql,
        {"user_id": user_id}
    ).scalar_one()

    # 현재 페이지 댓글 5개
    comments_sql = text("""
        SELECT
            c.comment_id,
            c.post_id,
            c.content,
            c.created_at,
            p.title AS post_title
        FROM comments c
        JOIN community_posts p
            ON c.post_id = p.post_id
        WHERE c.user_id = :user_id
        ORDER BY c.created_at DESC, c.comment_id DESC
        LIMIT :page_size OFFSET :offset
    """)

    rows = db.execute(
        comments_sql,
        {
            "user_id": user_id,
            "page_size": page_size,
            "offset": offset
        }
    ).mappings().all()

    return {
        "comments": [
            {
                "comment_id": row["comment_id"],
                "post_id": row["post_id"],
                "post_title": row["post_title"],
                "content": row["content"],
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                )
            }
            for row in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size
    }
