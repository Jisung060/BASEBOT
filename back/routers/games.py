from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

router = APIRouter(prefix="/api/games", tags=["games"])

@router.get("")
def get_games(
    date: Optional[str] = Query(None, description="조회할 날짜 (YYYY-MM-DD 형식)"),
    status: Optional[str] = Query(None, description="경기 상태 (Final, Scheduled 등)"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_session)
):
    """
    날짜별 경기 일정 및 결과 조회 API
    """
    query_str = """
        SELECT 
            g.game_id,
            g.game_date,
            g.status,
            g.home_score,
            g.away_score,
            ht.team_id AS home_team_id,
            ht.team_name AS home_team_name,
            ht.team_code AS home_team_code,
            ht.logo_url AS home_logo_url,
            at.team_id AS away_team_id,
            at.team_name AS away_team_name,
            at.team_code AS away_team_code,
            at.logo_url AS away_logo_url
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE 1=1
    """
    params = {"limit": limit}

    if date:
        query_str += " AND DATE(g.game_date) = :date"
        params["date"] = date
    if status:
        query_str += " AND g.status = :status"
        params["status"] = status

    query_str += " ORDER BY g.game_date ASC LIMIT :limit"

    rows = db.execute(text(query_str), params).mappings().all()
    return rows