from fastapi import APIRouter, Depends, Query
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
    size: int = Query(default=5, ge=1, le=100),
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user)
):
    page_size = size
    offset = (page - 1) * page_size
    user_id = current_user.user_id

    # -----------------------------------------------------
    # 전체 댓글 수 및 댓글 좋아요 합계
    # -----------------------------------------------------

    summary_sql = text(
        """
       SELECT COUNT(*) AS total_comments,
              COALESCE(SUM(c.like_count), 0) AS total_likes
       FROM comments c
                INNER JOIN community_posts p
                           ON c.post_id = p.post_id
       WHERE c.user_id = :user_id
         AND p.status = 'ACTIVE'
       """)

    summary = db.execute(
        summary_sql,
        {"user_id": user_id}
    ).mappings().one()

    total = summary["total_comments"]

    # -----------------------------------------------------
    # 댓글 목록
    # -----------------------------------------------------

    comments_sql = text("""
        SELECT
            c.comment_id,
            c.post_id,
            c.content,
            c.parent_comment_id, 
            c.like_count AS comment_like_count,
            c.created_at,

            p.title AS post_title,
            p.category AS post_category,
            p.like_count AS post_like_count,
            p.comment_count AS post_comment_count,

            t.team_name AS team_name

        FROM comments c

        INNER JOIN community_posts p
            ON c.post_id = p.post_id

        LEFT JOIN teams t
            ON p.related_team_id = t.team_id

        WHERE c.user_id = :user_id
            AND p.status = 'ACTIVE'

        ORDER BY
            c.created_at DESC,
            c.comment_id DESC

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

    comments = []

    for row in rows:
        comments.append({
            "comment_id": row["comment_id"],
            "post_id": row["post_id"],
            "post_title": row["post_title"],
            "post_category": row["post_category"],
            "team_name": row["team_name"],
            "content": row["content"],
            "parent_comment_id": row["parent_comment_id"],
            "comment_like_count": row["comment_like_count"] or 0,
            "post_like_count": row["post_like_count"] or 0,
            "post_comment_count": row["post_comment_count"] or 0,
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            )
        })

    # -----------------------------------------------------
    # 응답
    # -----------------------------------------------------

    return {
        "comments": comments,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size,
        "summary": {
            "total_comments": total,
            "total_likes": summary["total_likes"] or 0
        }
    }