from typing import Optional
import requests
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

router = APIRouter(prefix="/api/games", tags=["games"])

@router.get("")
def get_games(
    date: Optional[str] = Query(None, description="조회할 날짜 (YYYY-MM-DD 형식)"),
    status: Optional[str] = Query(None, description="경기 상태 (FINAL, SCHEDULED 등)"),
    order: str = Query("desc", description="정렬 순서 (desc: 최신순, asc: 과거순)"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session)
):
    """
    날짜별 경기 일정 및 결과 조회 API (최신순 정렬 지원)
    """
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"

    query_str = f"""
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

    # 기존: query_str += " ORDER BY g.game_date ASC LIMIT :limit"
    # 수정: 최신 날짜 및 시간순으로 정렬 (game_date와 game_time이 분리되어 있다면 둘 다 DESC)
    query_str += " ORDER BY g.game_date DESC, g.game_time DESC LIMIT :limit"

    rows = db.execute(text(query_str), params).mappings().all()
    return rows

@router.get("/{game_id}/boxscore")
def get_game_boxscore(game_id: int):
    """
    특정 경기의 이닝별 라인스코어(Linescore) 및 팀별 R/H/E 박스스코어 조회
    """
    url = f"https://statsapi.mlb.com/api/v1/game/{game_id}/linescore"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="해당 경기의 박스스코어 정보를 찾을 수 없습니다.")
        resp.raise_for_status()
        data = resp.json()

        innings_data = []
        for inn in data.get("innings", []):
            innings_data.append({
                "num": inn.get("num"),
                "away_runs": inn.get("away", {}).get("runs", 0),
                "home_runs": inn.get("home", {}).get("runs", 0)
            })

        teams_data = data.get("teams", {})
        away_stats = teams_data.get("away", {})
        home_stats = teams_data.get("home", {})

        return {
            "game_id": game_id,
            "current_inning": data.get("currentInningOrdinal", "Final"),
            "innings": innings_data,
            "away_total": {
                "runs": away_stats.get("runs", 0),
                "hits": away_stats.get("hits", 0),
                "errors": away_stats.get("errors", 0)
            },
            "home_total": {
                "runs": home_stats.get("runs", 0),
                "hits": home_stats.get("hits", 0),
                "errors": home_stats.get("errors", 0)
            }
        }
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"MLB API 연동 오류: {str(e)}")