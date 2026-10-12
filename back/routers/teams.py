import traceback
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
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
# 2. 특정 팀 상세 및 로스터 (team-detail.html)
# ----------------------------------------------------
@router.get("/{team_id}")
@router.get("/{team_id}/roster")
def get_team_detail_and_roster(team_id: int, season: int = 2024, db: Session = Depends(get_session)):
    try:
        # 1. 구단 기본 정보 (SELECT * 로 컬럼명 불일치 원천 방지)
        team_query = text("SELECT * FROM teams WHERE team_id = :team_id")
        team = db.execute(team_query, {"team_id": int(team_id)}).mappings().first()
        if not team:
            raise HTTPException(status_code=404, detail="해당 구단을 찾을 수 없습니다.")

        # 2. 타자 로스터
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
            WHERE p.team_id = :team_id 
              AND s.season = :season 
              AND s.is_pitcher = FALSE
            ORDER BY s.bwar DESC, s.games DESC
        """)
        raw_batters = db.execute(batters_query, {"team_id": int(team_id), "season": season}).mappings().all()

        # 3. 투수 로스터
        pitchers_query = text("""
            SELECT 
                p.player_id, p.player_name, p.headshot_url, p.jersey_number,
                p.position, p.birth_date, p.throws,
                s.games, s.wins, s.losses, s.era, s.innings_pitched,
                s.strikeouts, s.walks, s.whip, s.fip,
                s.bwar, s.fwar
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE p.team_id = :team_id 
              AND s.season = :season 
              AND s.is_pitcher = TRUE
            ORDER BY s.innings_pitched DESC, s.bwar DESC
        """)
        raw_pitchers = db.execute(pitchers_query, {"team_id": int(team_id), "season": season}).mappings().all()

        # 타자 정제 (ops 계산 보강)
        batters = []
        for b in raw_batters:
            item = dict(b)
            item["age"] = calculate_age(b.get("birth_date"))
            item["bt"] = f"{b.get('bats') or '-'}/{b.get('throws') or '-'}"
            item["jersey_number"] = b.get("jersey_number") if b.get("jersey_number") else "-"
            
            # Decimal -> float 변환
            avg_val = float(b["batting_avg"]) if b.get("batting_avg") is not None else 0.0
            item["batting_avg"] = float(b["batting_avg"]) if b.get("batting_avg") is not None else None
            item["bwar"] = float(b["bwar"]) if b.get("bwar") is not None else None
            item["fwar"] = float(b["fwar"]) if b.get("fwar") is not None else None

            # OPS 추정치/계산치 (xSLG와 batting_avg 기반 또는 근사치 제공)
            # 만약 xslg가 있으면 (타율 + 0.070 출루율 추정 + 장타율) 기반 정밀 추정, 없을 경우 기본 처리
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
            
            # Decimal -> float 안전 변환 및 ERA+ 계산
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
            "season": season,
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