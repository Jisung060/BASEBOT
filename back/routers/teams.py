import traceback
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_session

router = APIRouter(prefix="/api/teams", tags=["teams"])

def calculate_age(birth_date_str):
    if not birth_date_str:
        return "-"
    try:
        born = date.fromisoformat(str(birth_date_str)[:10])
        today = date.today()
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    except Exception:
        return "-"

# ----------------------------------------------------
# 1. 30개 구단 전체 목록 (teams.html)
# ----------------------------------------------------
@router.get("")
@router.get("/")
def get_all_teams(db: Session = Depends(get_session)):
    query = text("SELECT * FROM teams ORDER BY league ASC, division ASC, team_name ASC")
    return db.execute(query).mappings().all()

# ----------------------------------------------------
# 2. 특정 팀 상세 및 시즌별 로스터 (team-detail.html)
# ----------------------------------------------------
@router.get("/{team_id}")
@router.get("/{team_id}/roster")
def get_team_detail_and_roster(
    team_id: int,
    season: Optional[int] = Query(None, description="조회할 시즌 연도 (미입력 시 최신 시즌 자동 선택)"),
    db: Session = Depends(get_session)
):
    try:
        # 1. 구단 기본 정보
        team_query = text("SELECT * FROM teams WHERE team_id = :team_id")
        team = db.execute(team_query, {"team_id": int(team_id)}).mappings().first()
        if not team:
            raise HTTPException(status_code=404, detail="해당 구단을 찾을 수 없습니다.")

        # 2. 해당 구단에 데이터가 존재하는 시즌 목록 조회 (최신순)
        seasons_query = text("""
            SELECT DISTINCT s.season
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE COALESCE(s.team_id, p.team_id) = :team_id
              AND s.season IS NOT NULL
            ORDER BY s.season DESC
        """)
        season_rows = db.execute(seasons_query, {"team_id": int(team_id)}).scalars().all()
        available_seasons = [int(s) for s in season_rows if s is not None]

        # 만약 해당 구단에 아직 기록이 없다면 전체 DB 최신 시즌 확인
        if not available_seasons:
            global_seasons = db.execute(
                text("SELECT DISTINCT season FROM player_season_stats WHERE season IS NOT NULL ORDER BY season DESC")
            ).scalars().all()
            available_seasons = [int(s) for s in global_seasons if s is not None] or [2024]

        # 요청된 season이 없으면 가장 최신 시즌을 기본값으로 사용
        target_season = int(season) if season is not None else available_seasons[0]

        # 3. 타자 로스터 (player_season_stats.team_id 우선 기준)
        batters_query = text("""
            SELECT 
                p.player_id, p.player_name, p.headshot_url, p.jersey_number,
                p.position, p.birth_date, p.bats, p.throws,
                s.games, s.hits, s.home_runs, s.rbi,
                s.batting_avg,
                s.wrc_plus, s.bwar, s.fwar,
                s.xba, s.xslg, s.xwoba
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE COALESCE(s.team_id, p.team_id) = :team_id 
              AND s.season = :season 
              AND s.is_pitcher = FALSE
            ORDER BY s.bwar DESC, s.games DESC
        """)
        raw_batters = db.execute(
            batters_query, {"team_id": int(team_id), "season": target_season}
        ).mappings().all()

        # 4. 투수 로스터 (player_season_stats.team_id 우선 기준)
        pitchers_query = text("""
            SELECT 
                p.player_id, p.player_name, p.headshot_url, p.jersey_number,
                p.position, p.birth_date, p.throws,
                s.games, s.wins, s.losses, s.era, s.innings_pitched,
                s.strikeouts, s.walks, s.whip, s.fip,
                s.bwar, s.fwar
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE COALESCE(s.team_id, p.team_id) = :team_id 
              AND s.season = :season 
              AND s.is_pitcher = TRUE
            ORDER BY s.innings_pitched DESC, s.bwar DESC
        """)
        raw_pitchers = db.execute(
            pitchers_query, {"team_id": int(team_id), "season": target_season}
        ).mappings().all()

        # 타자 정제
        batters = []
        for b in raw_batters:
            item = dict(b)
            item["age"] = calculate_age(b.get("birth_date"))
            item["bt"] = f"{b.get('bats') or '-'}/{b.get('throws') or '-'}"
            item["jersey_number"] = b.get("jersey_number") if b.get("jersey_number") else "-"
            
            avg_val = float(b["batting_avg"]) if b.get("batting_avg") is not None else 0.0
            item["batting_avg"] = float(b["batting_avg"]) if b.get("batting_avg") is not None else None
            item["bwar"] = float(b["bwar"]) if b.get("bwar") is not None else None
            item["fwar"] = float(b["fwar"]) if b.get("fwar") is not None else None

            if b.get("xslg") is not None:
                approx_obp = avg_val + 0.065
                item["ops"] = round(approx_obp + float(b["xslg"]), 3)
            else:
                item["ops"] = round(avg_val * 2.5, 3) if avg_val > 0 else "-"
                
            batters.append(item)

        # 투수 정제
        pitchers = []
        for p in raw_pitchers:
            item = dict(p)
            item["age"] = calculate_age(p.get("birth_date"))
            item["jersey_number"] = p.get("jersey_number") if p.get("jersey_number") else "-"
            
            era_val = float(p["era"]) if p.get("era") is not None else None
            item["era"] = era_val
            item["innings_pitched"] = float(p["innings_pitched"]) if p.get("innings_pitched") is not None else None
            item["whip"] = float(p["whip"]) if p.get("whip") is not None else None
            item["fip"] = float(p["fip"]) if p.get("fip") is not None else None
            item["bwar"] = float(p["bwar"]) if p.get("bwar") is not None else None
            item["fwar"] = float(p["fwar"]) if p.get("fwar") is not None else None

            if era_val is not None and era_val > 0:
                item["era_plus"] = int(round((4.15 / era_val) * 100))
            else:
                item["era_plus"] = "-"
                
            pitchers.append(item)

        return {
            "team": dict(team),
            "season": target_season,
            "available_seasons": available_seasons,
            "batters": batters,
            "pitchers": pitchers
        }

    except HTTPException:
        raise
    except Exception as e:
        print("\n================ [ERROR in get_team_detail_and_roster] ================")
        traceback.print_exc()
        print("========================================================================\n")
        raise HTTPException(status_code=500, detail=str(e))