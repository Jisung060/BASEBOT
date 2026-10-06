from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from schemas.player_schema import PlayerSummaryResponse, PlayerDetailResponse, PlayerSeasonStatResponse

router = APIRouter(prefix="/api/players", tags=["players"])

@router.get("", response_model=list[PlayerSummaryResponse])
def get_players(
    name: Optional[str] = Query(None, description="선수 이름 검색 (영문)"),
    team_id: Optional[int] = Query(None, description="소속 구단 team_id"),
    season: int = Query(2024, description="시즌 연도"),
    sort_by: str = Query("home_runs", description="정렬 기준 (home_runs, batting_avg, bwar, avg_exit_velocity, hits)"),
    order: str = Query("desc", description="정렬 순서 (asc 또는 desc)"),
    limit: int = Query(50, ge=1, le=200, description="가져올 선수 수"),
    offset: int = Query(0, ge=0, description="건너뛸 선수 수 (페이지네이션)"),
    db: Session = Depends(get_session)
):
    """
    선수 목록 및 랭킹 조회 API (필터, 검색, 정렬 지원)
    """
    # SQL 인젝션 방지를 위한 정렬 컬럼 화이트리스트
    allowed_sort_fields = {
        "home_runs": "s.home_runs",
        "batting_avg": "s.batting_avg",
        "bwar": "s.bwar",
        "avg_exit_velocity": "s.avg_exit_velocity",
        "hits": "s.hits",
        "player_name": "p.player_name"
    }
    sort_column = allowed_sort_fields.get(sort_by, "s.home_runs")
    sort_direction = "DESC" if order.lower() == "desc" else "ASC"

    # 동적 쿼리 작성
    query_str = f"""
        SELECT 
            p.player_id,
            p.player_name,
            p.headshot_url,
            p.team_id,
            t.team_name,
            t.team_code,
            s.games,
            s.batting_avg,
            s.home_runs,
            s.rbi,
            s.bwar,
            s.avg_exit_velocity
        FROM players p
        INNER JOIN player_season_stats s ON p.player_id = s.player_id AND s.season = :season
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE 1=1
    """
    params = {"season": season, "limit": limit, "offset": offset}

    if name:
        query_str += " AND p.player_name LIKE :name"
        params["name"] = f"%{name}%"
    
    if team_id:
        query_str += " AND p.team_id = :team_id"
        params["team_id"] = team_id

    query_str += f" ORDER BY {sort_column} {sort_direction}, s.home_runs DESC LIMIT :limit OFFSET :offset"

    result = db.execute(text(query_str), params).mappings().all()
    return result


@router.get("/{player_id}", response_model=PlayerDetailResponse)
def get_player_detail(
    player_id: int,
    db: Session = Depends(get_session)
):
    """
    선수 상세 정보 및 전시즌 세이버메트릭스 기록 조회 API
    """
    # 1. 선수 기본 프로필 및 소속팀 조회
    player_query = text("""
        SELECT 
            p.player_id,
            p.player_name,
            p.headshot_url,
            p.team_id,
            t.team_name,
            t.team_code
        FROM players p
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE p.player_id = :player_id
    """)
    player_row = db.execute(player_query, {"player_id": player_id}).mappings().first()

    if not player_row:
        raise HTTPException(status_code=404, detail="해당 선수를 찾을 수 없습니다.")

    # 2. 해당 선수의 시즌별 스탯 조회 (최신 시즌 순)
    stats_query = text("""
        SELECT 
            season,
            is_pitcher,
            games,
            batting_avg,
            hits,
            home_runs,
            rbi,
            bwar,
            avg_exit_velocity,
            barrel_percentage,
            hard_hit_percentage
        FROM player_season_stats
        WHERE player_id = :player_id
        ORDER BY season DESC
    """)
    stats_rows = db.execute(stats_query, {"player_id": player_id}).mappings().all()

    return {
        "player_id": player_row["player_id"],
        "player_name": player_row["player_name"],
        "headshot_url": player_row["headshot_url"],
        "team_id": player_row["team_id"],
        "team_name": player_row["team_name"],
        "team_code": player_row["team_code"],
        "stats": stats_rows
    }