from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

router = APIRouter(
    prefix="/api/main",
    tags=["메인 페이지"],
)

@router.get("/community-posts")
def get_community_post(
        db: Session = Depends(get_session)
):
    sql = text("""
        SELECT 
            post_id,
            title,
            created_at
        FROM community_posts
        order by created_at desc, post_id DESC
            LIMIT 4
    """)

    rows = db.execute(sql).mappings().all()

    return {
        "posts": [
            {
                "post_id": row["post_id"],
                "title": row["title"],
                "created_at": row["created_at"]
            }
            for row in rows
        ]
    }
