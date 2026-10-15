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


def get_team_standing_and_record(db: Session, team_info: dict, season: int) -> dict:
    """
    해당 시즌의 지구(Division) 내 순위 및 승-패-승률 산출
    (1순위: 시즌 투수진 총 승패 합계 / 2순위: games 테이블 경기 결과 집계)
    """
    league = team_info.get("league")
    division = team_info.get("division")
    target_tid = int(team_info["team_id"])

    # 같은 지구(Division) 소속 구단 전체 조회
    div_teams_sql = text("""
        SELECT team_id, team_name
        FROM teams
        WHERE league = :league AND division = :division
    """)
    div_teams = db.execute(div_teams_sql, {"league": league, "division": division}).mappings().all()
    if not div_teams:
        div_teams = [{"team_id": target_tid, "team_name": team_info.get("team_name")}]

    standings = []
    for dt in div_teams:
        tid = int(dt["team_id"])

        # 1) player_season_stats의 투수 승/패 합산 조회 (시즌 전체 162경기 성적 반영에 유리)
        stat_wl = db.execute(text("""
            SELECT SUM(COALESCE(s.wins, 0)) AS w, SUM(COALESCE(s.losses, 0)) AS l
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE COALESCE(s.team_id, p.team_id) = :tid
              AND s.season = :season
              AND s.is_pitcher = TRUE
        """), {"tid": tid, "season": season}).mappings().first()

        wins = int(stat_wl["w"] or 0) if stat_wl else 0
        losses = int(stat_wl["l"] or 0) if stat_wl else 0

        # 2) 만약 투수 스탯 승패 합계가 너무 적다면 games 테이블에서 해당 연도 승패 직접 집계
        if (wins + losses) < 10:
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
            """), {"tid": tid, "season": season}).mappings().first()

            gw = int(game_wl["gw"] or 0) if game_wl else 0
            gl = int(game_wl["gl"] or 0) if game_wl else 0
            if (gw + gl) > (wins + losses):
                wins, losses = gw, gl

        total = wins + losses
        win_pct = round(wins / total, 3) if total > 0 else 0.0
        standings.append({
            "team_id": tid,
            "wins": wins,
            "losses": losses,
            "win_pct": win_pct
        })

    # 승률 내림차순, 다승 내림차순 정렬하여 지구 순위 부여
    standings.sort(key=lambda x: (x["win_pct"], x["wins"]), reverse=True)

    my_standing = next((item for idx, item in enumerate(standings, start=1) if item["team_id"] == target_tid and not item.update({"rank": idx})), None)
    if not my_standing:
        for idx, item in enumerate(standings, start=1):
            if item["team_id"] == target_tid:
                my_standing = {**item, "rank": idx}
                break

    rank_num = my_standing["rank"] if my_standing else 1
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(rank_num if rank_num < 20 else rank_num % 10, "th")

    return {
        "wins": my_standing["wins"] if my_standing else 0,
        "losses": my_standing["losses"] if my_standing else 0,
        "win_pct": f"{my_standing['win_pct']:.3f}".replace("0.", ".") if my_standing else ".000",
        "division_rank": rank_num,
        "division_rank_en": f"{rank_num}{suffix} in {league} {division}",
        "division_rank_kr": f"{league} {division} {rank_num}위"
    }


def get_team_season_sabermetrics(db: Session, team_id: int, season: int) -> dict:
    """해당 구단의 시즌 12대 세이버메트릭스 요약 지표 산출"""
    bat_sql = text("""
        SELECT 
            ROUND(AVG(s.wrc_plus), 0) AS wrc_plus,
            ROUND(AVG(s.xwoba), 3) AS xwoba,
            ROUND(AVG(s.avg_exit_velocity), 1) AS avg_exit_velo,
            ROUND(AVG(s.barrel_percentage), 1) AS barrel_pct,
            ROUND(AVG(s.hard_hit_percentage), 1) AS hard_hit_pct,
            SUM(COALESCE(s.outs_above_average, 0)) AS team_oaa,
            ROUND(AVG(s.sprint_speed), 1) AS sprint_speed,
            ROUND(AVG(s.bwar), 2) AS avg_bwar
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        WHERE COALESCE(s.team_id, p.team_id) = :tid
          AND s.season = :season
          AND s.is_pitcher = FALSE
    """)
    bat = db.execute(bat_sql, {"tid": team_id, "season": season}).mappings().first() or {}

    pit_sql = text("""
        SELECT 
            ROUND(AVG(s.era), 2) AS era,
            ROUND(AVG(s.fip), 2) AS fip,
            ROUND(AVG(s.fastball_velocity), 1) AS fastball_velo,
            ROUND(AVG(s.k_percentage), 1) AS pit_k_pct
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        WHERE COALESCE(s.team_id, p.team_id) = :tid
          AND s.season = :season
          AND s.is_pitcher = TRUE
    """)
    pit = db.execute(pit_sql, {"tid": team_id, "season": season}).mappings().first() or {}

    return {
        "wrc_plus": int(bat["wrc_plus"]) if bat.get("wrc_plus") is not None else 100,
        "xwoba": float(bat["xwoba"]) if bat.get("xwoba") is not None else 0.315,
        "avg_exit_velo": float(bat["avg_exit_velo"]) if bat.get("avg_exit_velo") is not None else 88.5,
        "barrel_pct": float(bat["barrel_pct"]) if bat.get("barrel_pct") is not None else 7.5,
        "hard_hit_pct": float(bat["hard_hit_pct"]) if bat.get("hard_hit_pct") is not None else 38.0,
        "fip": float(pit["fip"]) if pit.get("fip") is not None else 4.10,
        "era": float(pit["era"]) if pit.get("era") is not None else 4.15,
        "fastball_velo": float(pit["fastball_velo"]) if pit.get("fastball_velo") is not None else 93.8,
        "pit_k_pct": float(pit["pit_k_pct"]) if pit.get("pit_k_pct") is not None else 22.0,
        "team_oaa": int(bat["team_oaa"]) if bat.get("team_oaa") is not None else 0,
        "sprint_speed": float(bat["sprint_speed"]) if bat.get("sprint_speed") is not None else 27.0,
        "avg_bwar": float(bat["avg_bwar"]) if bat.get("avg_bwar") is not None else 1.20
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

        # 5. 타자 로스터
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
            WHERE COALESCE(s.team_id, p.team_id) = :team_id 
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

            if b.get("xslg") is not None:
                approx_obp = avg_val + 0.065
                item["ops"] = round(approx_obp + float(b["xslg"]), 3)
            else:
                item["ops"] = round(avg_val * 2.5, 3) if avg_val > 0 else "-"
                
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