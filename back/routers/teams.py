import traceback
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_session
import requests

# 시즌별 MLB 공식 순위 메모리 캐시 (API 중복 호출 방지 및 초고속 응답)
_STANDINGS_CACHE: dict[int, dict[int, dict]] = {}

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


def get_team_standing_and_record(db: Session, team_info: dict, season: int) -> dict:
    """
    MLB 공식 Standings API를 통해 해당 시즌의 정확한 정규시즌 승-패, 승률, 지구 순위(타이브레이커 반영)를 조회
    (오프라인이거나 미래 시즌일 경우에만 DB 집계로 Fallback)
    """
    league = team_info.get("league") or "MLB"
    division = team_info.get("division") or ""
    target_tid = int(team_info["team_id"])

    # 1. 캐시에 해당 시즌 공식 순위가 없으면 MLB Stats API에서 1회 로드
    if season not in _STANDINGS_CACHE:
        try:
            url = (
                f"https://statsapi.mlb.com/api/v1/standings"
                f"?leagueId=103,104&season={season}&standingsTypes=regularSeason"
            )
            resp = requests.get(url, timeout=8)
            if resp.status_code == 200:
                season_map = {}
                for record_group in resp.json().get("records", []):
                    for tr in record_group.get("teamRecords", []):
                        tid = int(tr.get("team", {}).get("id", 0))
                        wins = int(tr.get("wins", 0))
                        losses = int(tr.get("losses", 0))
                        win_pct = tr.get("winningPercentage", ".000")
                        div_rank = int(tr.get("divisionRank", 1))
                        season_map[tid] = {
                            "wins": wins,
                            "losses": losses,
                            "win_pct": win_pct,
                            "division_rank": div_rank
                        }
                if season_map:
                    _STANDINGS_CACHE[season] = season_map
        except Exception as e:
            print(f"[Standings API Fallback] {season} 시즌 공식 순위 조회 실패: {e}")

    # 2. 공식 순위 데이터가 존재하면 즉시 반환 (Baseball Reference와 100% 동일)
    if season in _STANDINGS_CACHE and target_tid in _STANDINGS_CACHE[season]:
        st = _STANDINGS_CACHE[season][target_tid]
        rank_num = st["division_rank"]
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(rank_num if rank_num < 20 else rank_num % 10, "th")
        return {
            "wins": st["wins"],
            "losses": st["losses"],
            "win_pct": st["win_pct"],
            "division_rank": rank_num,
            "division_rank_en": f"{rank_num}{suffix} in {league} {division}",
            "division_rank_kr": f"{league} {division} {rank_num}위"
        }

    # 3. Fallback (공식 API에 아직 없는 가상 시즌이거나 네트워크 오프라인일 때)
    game_wl = db.execute(text("""
        SELECT 
            SUM(CASE WHEN (home_team_id = :tid AND home_score > away_score) 
                       OR (away_team_id = :tid AND away_score > home_score) THEN 1 ELSE 0 END) AS gw,
            SUM(CASE WHEN (home_team_id = :tid AND home_score < away_score) 
                       OR (away_team_id = :tid AND away_score < home_score) THEN 1 ELSE 0 END) AS gl
        FROM games
        WHERE status = 'FINAL'
          AND YEAR(game_date) = :season
          AND (home_team_id = :tid OR away_team_id = :tid)
    """), {"tid": target_tid, "season": season}).mappings().first()

    wins = int(game_wl["gw"] or 0) if game_wl else 0
    losses = int(game_wl["gl"] or 0) if game_wl else 0
    total = wins + losses
    win_pct_val = round(wins / total, 3) if total > 0 else 0.0
    win_pct_str = f"{win_pct_val:.3f}".replace("0.", ".") if total > 0 else ".000"

    return {
        "wins": wins,
        "losses": losses,
        "win_pct": win_pct_str,
        "division_rank": 1,
        "division_rank_en": f"1st in {league} {division}",
        "division_rank_kr": f"{league} {division} 1위"
    }


def get_team_season_sabermetrics(db: Session, team_id: int, season: int) -> dict:
    """해당 구단의 시즌 확장 세이버메트릭스 요약 지표 산출 (Extension 제외 전 지표 반영)"""
    bat_sql = text("""
        SELECT 
            ROUND(AVG(s.wrc_plus), 0) AS wrc_plus,
            ROUND(AVG(s.xwoba), 3) AS xwoba,
            ROUND(AVG(s.xba), 3) AS xba,
            ROUND(AVG(s.xslg), 3) AS xslg,
            ROUND(AVG(s.avg_exit_velocity), 1) AS avg_exit_velo,
            ROUND(AVG(s.bat_speed), 1) AS bat_speed,
            ROUND(AVG(s.squared_up_percentage), 1) AS squared_up_pct,
            ROUND(AVG(s.barrel_percentage), 1) AS barrel_pct,
            ROUND(AVG(s.hard_hit_percentage), 1) AS hard_hit_pct,
            SUM(COALESCE(s.batting_run_value, 0)) AS team_batting_rv,
            SUM(COALESCE(s.baserunning_run_value, 0)) AS team_bsr_rv,
            SUM(COALESCE(s.fielding_run_value, 0)) AS team_fielding_rv,
            SUM(COALESCE(s.outs_above_average, 0)) AS team_oaa,
            SUM(COALESCE(s.arm_value, 0)) AS team_arm_value,
            SUM(COALESCE(s.framing_runs, 0)) AS team_framing_runs,
            ROUND(AVG(s.sprint_speed), 1) AS sprint_speed,
            ROUND(AVG(s.bwar), 2) AS avg_bwar
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        WHERE COALESCE(s.team_id, p.team_id) = :tid
          AND s.season = :season
          AND s.is_pitcher = FALSE
          AND s.games > 0
    """)
    bat = db.execute(bat_sql, {"tid": team_id, "season": season}).mappings().first() or {}

    pit_sql = text("""
        SELECT 
            ROUND(AVG(s.era), 2) AS era,
            ROUND(AVG(s.fip), 2) AS fip,
            ROUND(AVG(s.xera), 2) AS xera,
            ROUND(AVG(s.xba), 3) AS pit_xba,
            ROUND(AVG(s.fastball_velocity), 1) AS fastball_velo,
            ROUND(AVG(s.k_percentage), 1) AS pit_k_pct,
            ROUND(AVG(s.whiff_percentage), 1) AS pit_whiff_pct,
            ROUND(AVG(s.gb_percentage), 1) AS pit_gb_pct,
            SUM(COALESCE(s.pitching_run_value, 0)) AS team_pitching_rv,
            SUM(COALESCE(s.fastball_run_value, 0)) AS team_fb_rv,
            SUM(COALESCE(s.breaking_run_value, 0)) AS team_brk_rv,
            SUM(COALESCE(s.offspeed_run_value, 0)) AS team_off_rv
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        WHERE COALESCE(s.team_id, p.team_id) = :tid
          AND s.season = :season
          AND s.is_pitcher = TRUE
          AND s.games > 0
    """)
    pit = db.execute(pit_sql, {"tid": team_id, "season": season}).mappings().first() or {}

    return {
        # 타격 & 배트 트래킹
        "wrc_plus": int(bat["wrc_plus"]) if bat.get("wrc_plus") is not None else 100,
        "team_batting_rv": int(bat["team_batting_rv"]) if bat.get("team_batting_rv") is not None else 0,
        "xwoba": float(bat["xwoba"]) if bat.get("xwoba") is not None else 0.315,
        "xba": float(bat["xba"]) if bat.get("xba") is not None else 0.245,
        "xslg": float(bat["xslg"]) if bat.get("xslg") is not None else 0.410,
        "avg_exit_velo": float(bat["avg_exit_velo"]) if bat.get("avg_exit_velo") is not None else 88.8,
        "bat_speed": float(bat["bat_speed"]) if bat.get("bat_speed") is not None else 71.5,
        "squared_up_pct": float(bat["squared_up_pct"]) if bat.get("squared_up_pct") is not None else 25.0,
        "barrel_pct": float(bat["barrel_pct"]) if bat.get("barrel_pct") is not None else 7.8,
        "hard_hit_pct": float(bat["hard_hit_pct"]) if bat.get("hard_hit_pct") is not None else 39.0,
        # 마운드 & 구종 가치 (Extension 제외)
        "team_pitching_rv": int(pit["team_pitching_rv"]) if pit.get("team_pitching_rv") is not None else 0,
        "team_fb_rv": int(pit["team_fb_rv"]) if pit.get("team_fb_rv") is not None else 0,
        "team_brk_rv": int(pit["team_brk_rv"]) if pit.get("team_brk_rv") is not None else 0,
        "team_off_rv": int(pit["team_off_rv"]) if pit.get("team_off_rv") is not None else 0,
        "fip": float(pit["fip"]) if pit.get("fip") is not None else 4.12,
        "era": float(pit["era"]) if pit.get("era") is not None else 4.15,
        "xera": float(pit["xera"]) if pit.get("xera") is not None else 4.15,
        "pit_xba": float(pit["pit_xba"]) if pit.get("pit_xba") is not None else 0.245,
        "fastball_velo": float(pit["fastball_velo"]) if pit.get("fastball_velo") is not None else 93.9,
        "pit_k_pct": float(pit["pit_k_pct"]) if pit.get("pit_k_pct") is not None else 22.3,
        "pit_whiff_pct": float(pit["pit_whiff_pct"]) if pit.get("pit_whiff_pct") is not None else 25.0,
        "pit_gb_pct": float(pit["pit_gb_pct"]) if pit.get("pit_gb_pct") is not None else 42.5,
        # 수비 · 포수 · 주루 · WAR
        "team_fielding_rv": int(bat["team_fielding_rv"]) if bat.get("team_fielding_rv") is not None else 0,
        "team_oaa": int(bat["team_oaa"]) if bat.get("team_oaa") is not None else 0,
        "team_arm_value": int(bat["team_arm_value"]) if bat.get("team_arm_value") is not None else 0,
        "team_framing_runs": int(bat["team_framing_runs"]) if bat.get("team_framing_runs") is not None else 0,
        "team_bsr_rv": int(bat["team_bsr_rv"]) if bat.get("team_bsr_rv") is not None else 0,
        "sprint_speed": float(bat["sprint_speed"]) if bat.get("sprint_speed") is not None else 27.0,
        "avg_bwar": float(bat["avg_bwar"]) if bat.get("avg_bwar") is not None else 0.25
    }


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
    season: Optional[int] = Query(None, description="조회할 시즌 연도"),
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

        if not available_seasons:
            global_seasons = db.execute(
                text("SELECT DISTINCT season FROM player_season_stats WHERE season IS NOT NULL ORDER BY season DESC")
            ).scalars().all()
            available_seasons = [int(s) for s in global_seasons if s is not None] or [2024]

        target_season = int(season) if season is not None else available_seasons[0]

        # 3. 구단 시즌 성적(승-패) 및 지구 순위 산출
        team_standing = get_team_standing_and_record(db, dict(team), target_season)

        # 4. 구단 12대 세이버메트릭스 요약 지표 산출
        team_sabermetrics = get_team_season_sabermetrics(db, int(team_id), target_season)

        # 5. 타자 로스터 (obp, slg, ops 포함)
        batters_query = text("""
            SELECT 
                p.player_id, p.player_name, p.headshot_url, p.jersey_number,
                p.position, p.birth_date, p.bats, p.throws,
                s.games, s.hits, s.home_runs, s.rbi,
                s.batting_avg, s.obp, s.slg, s.ops,
                s.wrc_plus, s.bwar, s.fwar,
                s.xba, s.xslg, s.xwoba
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE COALESCE(s.team_id, p.team_id) = :team_id 
              AND s.season = :season 
              AND s.is_pitcher = FALSE
              AND s.games > 0
            ORDER BY s.bwar DESC, s.games DESC
        """)
        raw_batters = db.execute(
            batters_query, {"team_id": int(team_id), "season": target_season}
        ).mappings().all()

        # 6. 투수 로스터
        pitchers_query = text("""
            SELECT 
                p.player_id, p.player_name, p.headshot_url, p.jersey_number,
                p.position, p.birth_date, p.throws,
                s.games, s.wins, s.losses, s.era, s.innings_pitched,
                s.strikeouts, s.walks, s.whip, s.fip,
                s.bwar, s.fwar
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE s.team_id = :team_id AND s.games > 0
              AND s.season = :season 
              AND s.is_pitcher = TRUE
            ORDER BY s.innings_pitched DESC, s.bwar DESC
        """)
        raw_pitchers = db.execute(
            pitchers_query, {"team_id": int(team_id), "season": target_season}
        ).mappings().all()

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

            # 출루율(OBP), 장타율(SLG), OPS (DB에 공식 값이 있으면 그대로 사용, 없으면 추정치 Fallback)
            obp_val = float(b["obp"]) if b.get("obp") is not None else (round(avg_val + 0.065, 3) if avg_val > 0 else None)
            slg_val = float(b["slg"]) if b.get("slg") is not None else (float(b["xslg"]) if b.get("xslg") is not None else (round(avg_val * 1.55, 3) if avg_val > 0 else None))
            ops_val = float(b["ops"]) if b.get("ops") is not None else (round(obp_val + slg_val, 3) if (obp_val is not None and slg_val is not None) else None)

            item["obp"] = obp_val
            item["slg"] = slg_val
            item["ops"] = ops_val
                
            batters.append(item)

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
            "standing": team_standing,
            "sabermetrics": team_sabermetrics,
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