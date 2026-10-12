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


@router.get("/game-results")
def get_game_results(
        db: Session = Depends(get_session)
):
    sql = text("""
        SELECT
            g.game_id,
            g.game_date,
            g.game_time,
            g.home_score,
            g.away_score,
            g.status,

            home.team_id AS home_team_id,
            home.team_name AS home_team_name,
            home.logo_url AS home_team_logo,

            away.team_id AS away_team_id,
            away.team_name AS away_team_name,
            away.logo_url AS away_team_logo

        FROM games g

        JOIN teams home
            ON g.home_team_id = home.team_id

        JOIN teams away
            ON g.away_team_id = away.team_id

        WHERE g.status = 'FINAL'

        ORDER BY
            g.game_date DESC,
            g.game_time DESC,
            g.game_id DESC

        LIMIT 3
    """)

    rows = db.execute(sql).mappings().all()

    return {
        "games": [
            {
                "game_id": row["game_id"],
                "game_date": (
                    row["game_date"].isoformat()
                    if row["game_date"] else None
                ),
                "game_time": (
                    str(row["game_time"])
                    if row["game_time"] else None
                ),
                "home_team_id": row["home_team_id"],
                "home_team_name": row["home_team_name"],
                "home_team_logo": row["home_team_logo"],
                "home_score": row["home_score"],
                "away_team_id": row["away_team_id"],
                "away_team_name": row["away_team_name"],
                "away_team_logo": row["away_team_logo"],
                "away_score": row["away_score"],
                "status": row["status"]
            }
            for row in rows
        ]
    }

