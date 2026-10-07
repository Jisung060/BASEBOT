from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_session
# from database import get_db
import models

router = APIRouter(prefix="/api/teams", tags=["teams"])

# @router.get("/")
# def get_all_teams_dd(db: Session = Depends(get_db)):
#     """회원가입 시 선호 구단 드롭다운 --및 팀 목록 페이지용-- API"""
#     teams = db.query(models.Team).order_by(models.Team.league, models.Team.division, models.Team.team_name).all()
#     return teams

@router.get("")
def get_all_teams(db: Session = Depends(get_session)):
    """30개 구단 목록 (리그/지구별 그룹화 조회용)"""
    query = text("""
        SELECT team_id, team_name, team_code, league, division, city, stadium, logo_url
        FROM teams
        ORDER BY league ASC, division ASC, team_name ASC
    """)
    rows = db.execute(query).mappings().all()
    return rows

@router.get("/{team_id}")
def get_team_detail(team_id: int, db: Session = Depends(get_session)):
    """특정 팀 정보 및 소속 선수(타자) 목록 조회"""
    # 1. 팀 기본 정보
    team_query = text("""
        SELECT team_id, team_name, team_code, league, division, city, stadium, logo_url
        FROM teams
        WHERE team_id = :team_id
    """)
    team = db.execute(team_query, {"team_id": team_id}).mappings().first()
    if not team:
        raise HTTPException(status_code=404, detail="해당 구단을 찾을 수 없습니다.")

    # 2. 팀 소속 선수 및 2024 시즌 주요 기록 조회
    players_query = text("""
        SELECT 
            p.player_id,
            p.player_name,
            p.headshot_url,
            s.games,
            s.batting_avg,
            s.home_runs,
            s.rbi,
            s.bwar,
            s.avg_exit_velocity
        FROM players p
        LEFT JOIN player_season_stats s ON p.player_id = s.player_id AND s.season = 2024
        WHERE p.team_id = :team_id
        ORDER BY s.home_runs DESC, p.player_name ASC
    """)
    roster = db.execute(players_query, {"team_id": team_id}).mappings().all()

    return {
        "team": team,
        "roster": roster
    }