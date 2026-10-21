from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from database.db_connection import get_session
import re
import math

router = APIRouter(prefix="/api/players", tags=["players"])

# 시즌별 전체 선수 분포 캐시 (백분위 실시간 정밀 계산용)
_SEASON_DIST_CACHE: dict[tuple[int, bool], list[dict]] = {}


def calculate_age(birth_date_str):
    if not birth_date_str:
        return "-"
    try:
        born = date.fromisoformat(str(birth_date_str)[:10])
        today = date.today()
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    except Exception:
        return "-"

def format_height_weight(height_str, weight_val) -> dict:
    """
    MLB 미국식 키(ft' in")와 몸무게(lbs)를 한국식(cm, kg)과 함께 병기하여 반환
    예: height_display = '6\' 4" (193cm)', weight_display = '190 lbs (86kg)'
    """
    h_us = str(height_str).strip() if height_str else None
    w_lbs = int(weight_val) if weight_val is not None and str(weight_val).isdigit() else None

    h_cm = None
    if h_us:
        m = re.search(r"(\d+)\s*'\s*(\d+)", h_us)
        if m:
            feet = int(m.group(1))
            inches = int(m.group(2))
            h_cm = round((feet * 12 + inches) * 2.54)

    w_kg = round(w_lbs * 0.45359237) if w_lbs else None

    height_display = f"{h_us} ({h_cm}cm)" if (h_us and h_cm) else (h_us or "-")
    weight_display = f"{w_lbs} lbs ({w_kg}kg)" if (w_lbs and w_kg) else (f"{w_lbs} lbs" if w_lbs else "-")

    if h_us and h_cm and w_lbs and w_kg:
        combined_display = f"{h_cm}cm / {w_kg}kg ({h_us}, {w_lbs} lbs)"
    elif h_us or w_lbs:
        combined_display = f"{height_display} / {weight_display}"
    else:
        combined_display = "-"

    return {
        "height_display": height_display,
        "weight_display": weight_display,
        "physical_display": combined_display
    }

def get_season_distribution(db: Session, season: int, is_pitcher: bool) -> list[dict]:
    key = (int(season), bool(is_pitcher))
    if key not in _SEASON_DIST_CACHE:
        if not is_pitcher:
            qual_sql = text("""
                SELECT *
                FROM player_season_stats
                WHERE season = :season AND is_pitcher = FALSE AND games >= 85
            """)
        else:
            qual_sql = text("""
                SELECT *
                FROM player_season_stats
                WHERE season = :season AND is_pitcher = TRUE AND innings_pitched >= 50
            """)

        rows = db.execute(qual_sql, {"season": int(season)}).mappings().all()
        if len(rows) < 50:
            rows = db.execute(text("""
                SELECT * FROM player_season_stats
                WHERE season = :season AND is_pitcher = :is_pitcher AND games >= 20
            """), {"season": int(season), "is_pitcher": bool(is_pitcher)}).mappings().all()

        _SEASON_DIST_CACHE[key] = [dict(r) for r in rows]
    return _SEASON_DIST_CACHE[key]


def calc_empirical_percentile(dist: list[dict], metric: str, val, higher_is_better: bool = True):
    """주전급(Qualified) 선수 분포 대비 정확한 백분위(1~100) 산출"""
    if val is None:
        return None
    try:
        target = float(val)
    except (ValueError, TypeError):
        return None

    valid_vals = []
    for r in dist:
        v = r.get(metric)
        if v is not None:
            try:
                valid_vals.append(float(v))
            except (ValueError, TypeError):
                pass

    if not valid_vals:
        return None

    n = len(valid_vals)
    if higher_is_better:
        less_cnt = sum(1 for x in valid_vals if x < target)
        equal_cnt = sum(1 for x in valid_vals if x == target)
    else:
        less_cnt = sum(1 for x in valid_vals if x > target)
        equal_cnt = sum(1 for x in valid_vals if x == target)

    pct = round(((less_cnt + 0.5 * equal_cnt) / n) * 100)
    return max(1, min(100, int(pct)))


@router.get("/search/autocomplete")
def search_players_and_teams(q: str = "", limit: int = 12, db: Session = Depends(get_session)):
    keyword = q.strip()
    if not keyword:
        return {"results": []}

    like_pattern = f"%{keyword}%"
    starts_pattern = f"{keyword}%"

    team_sql = text("""
        SELECT team_id, team_name, team_code, league, division, logo_url
        FROM teams
        WHERE team_name LIKE :kw OR team_code LIKE :kw OR city LIKE :kw
        ORDER BY CASE WHEN team_name LIKE :starts THEN 0 ELSE 1 END, team_name ASC
        LIMIT 3
    """)
    teams = db.execute(team_sql, {"kw": like_pattern, "starts": starts_pattern}).mappings().all()

    player_sql = text("""
        SELECT
            p.player_id, p.player_name, p.headshot_url, p.position, p.throws,
            t.team_name, t.team_code,
            (SELECT MAX(s.season) FROM player_season_stats s WHERE s.player_id = p.player_id) AS latest_season
        FROM players p
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE p.player_name LIKE :kw OR t.team_name LIKE :kw OR t.team_code LIKE :kw
        ORDER BY CASE WHEN p.player_name LIKE :starts THEN 0 ELSE 1 END, p.player_name ASC
        LIMIT :limit
    """)
    players = db.execute(player_sql, {"kw": like_pattern, "starts": starts_pattern, "limit": limit}).mappings().all()

    results = []
    for t in teams:
        results.append({
            "type": "team",
            "id": t["team_id"],
            "name": t["team_name"],
            "image_url": t["logo_url"] or f"https://www.mlbstatic.com/team-logos/{t['team_id']}.svg",
            "subtext": f"MLB | {t['league'] or ''} {t['division'] or ''} | {t['team_code'] or ''}"
        })

    for p in players:
        pos = p["position"] or "-"
        if pos == "P" and p["throws"]:
            pos = f"{p['throws']}HP"
        season_str = str(p["latest_season"]) if p["latest_season"] else "2024"
        full_team = p["team_name"] or p["team_code"] or "FA"
        short_team = full_team.split()[-1] if full_team not in ("Boston Red Sox", "Chicago White Sox", "Toronto Blue Jays") else " ".join(full_team.split()[-2:])

        results.append({
            "type": "player",
            "id": p["player_id"],
            "name": p["player_name"],
            "image_url": p["headshot_url"] or "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/generic/headshot/67/current",
            "subtext": f"MLB | {season_str} | {pos} | {short_team}"
        })

    return {"results": results}


def get_player_provenance(db, player_id):
    # Older databases may not have provenance yet; reading a player never creates tables.
    if not inspect(db.get_bind()).has_table("player_stat_provenance"):
        return {}
    rows = db.execute(text("""
        SELECT season, is_pitcher, metric, source, stored_value
        FROM player_stat_provenance
        WHERE player_id = :player_id AND metric IN ('bwar', 'fwar', 'wrc_plus')
    """), {"player_id": player_id}).mappings().all()
    return {(int(r["season"]), bool(r["is_pitcher"]), r["metric"]): r for r in rows}


def player_stat_sources(item, provenance):
    result = {}
    role = "pitching" if item.get("is_pitcher") else "batting"
    for metric in ("bwar", "fwar", "wrc_plus"):
        value = item.get(metric)
        info = {"status": "unknown", "label": "원본 미확보 · 기존 값 유지"}
        origin = provenance.get((int(item["season"]), bool(item.get("is_pitcher")), metric))
        if value is None or not math.isfinite(float(value)):
            info = {"status": "missing", "label": "데이터 없음"}
        elif origin and origin["stored_value"] is not None and math.isclose(float(value), float(origin["stored_value"]), rel_tol=1e-9, abs_tol=1e-6):
            source = origin["source"]
            if source == "estimated":
                info = {"status": "estimated", "label": "추정값 · 자체 계산"}
            else:
                provider = "Baseball-Reference" if metric == "bwar" else "FanGraphs"
                online = ("baseball_reference_http", "baseball_reference_pybaseball") if metric == "bwar" else ("fangraphs_http", "fangraphs_pybaseball")
                prefix = "bref" if metric == "bwar" else "fangraphs"
                if source in online:
                    info = {"status": "published", "label": f"{provider} · 온라인 원본"}
                elif source == f"local_csv:{prefix}_{role}_{item['season']}.csv":
                    info = {"status": "published", "label": f"{provider} · 원본 CSV"}
        result[metric] = info
    return result


@router.get("/{player_id}")
def get_player_detail(player_id: int, db: Session = Depends(get_session)):
    p_query = text("""
        SELECT
            p.*,
            t.team_name,
            t.team_code
        FROM players p
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE p.player_id = :player_id
    """)
    player = db.execute(p_query, {"player_id": player_id}).mappings().first()
    if not player:
        raise HTTPException(status_code=404, detail="해당 선수를 찾을 수 없습니다.")

    s_query = text("""
        SELECT
            s.*,
            COALESCE(st.team_id, p.team_id) AS season_team_id,
            COALESCE(st.team_name, pt.team_name) AS season_team_name,
            COALESCE(st.team_code, pt.team_code, 'MLB') AS season_team_code
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        LEFT JOIN teams st ON s.team_id = st.team_id
        LEFT JOIN teams pt ON p.team_id = pt.team_id
        WHERE s.player_id = :player_id AND s.games > 0
        ORDER BY s.season DESC
    """)
    all_stats = db.execute(s_query, {"player_id": player_id}).mappings().all()

    provenance = get_player_provenance(db, player_id)
    batting_stats = []
    pitching_stats = []
    seasons_set = set()

    for row in all_stats:
        item = dict(row)
        for k, v in item.items():
            if hasattr(v, "as_tuple"):
                item[k] = float(v)

        season_yr = int(item["season"]) if item.get("season") is not None else 2024
        seasons_set.add(season_yr)
        is_pit = bool(item.get("is_pitcher"))
        item["stat_sources"] = player_stat_sources(item, provenance)

        # 저장된 백분위를 우선 사용하고, 누락된 항목만 시즌 분포로 계산
        dist = get_season_distribution(db, season_yr, is_pit)

        if not is_pit:
            # 1) Value 지표
            item["batting_run_value_percentile"] = item.get("batting_run_value_percentile") if item.get("batting_run_value_percentile") is not None else calc_empirical_percentile(dist, "batting_run_value", item.get("batting_run_value"), True)
            item["baserunning_run_value_percentile"] = item.get("baserunning_run_value_percentile") if item.get("baserunning_run_value_percentile") is not None else calc_empirical_percentile(dist, "baserunning_run_value", item.get("baserunning_run_value"), True)
            item["oaa_percentile"] = item.get("oaa_percentile") if item.get("oaa_percentile") is not None else calc_empirical_percentile(dist, "outs_above_average", item.get("outs_above_average"), True)
            item["fielding_run_value_percentile"] = item.get("fielding_run_value_percentile") if item.get("fielding_run_value_percentile") is not None else calc_empirical_percentile(dist, "fielding_run_value", item.get("fielding_run_value"), True)
            item["arm_value_percentile"] = item.get("arm_value_percentile") if item.get("arm_value_percentile") is not None else calc_empirical_percentile(dist, "arm_value", item.get("arm_value"), True)

            # 2) Batting 지표 (Bat Speed & Squared-Up% 포함)
            item["xwoba_percentile"] = item.get("xwoba_percentile") if item.get("xwoba_percentile") is not None else calc_empirical_percentile(dist, "xwoba", item.get("xwoba"), True)
            item["xba_percentile"] = item.get("xba_percentile") if item.get("xba_percentile") is not None else calc_empirical_percentile(dist, "xba", item.get("xba"), True)
            item["xslg_percentile"] = item.get("xslg_percentile") if item.get("xslg_percentile") is not None else calc_empirical_percentile(dist, "xslg", item.get("xslg"), True)
            item["exit_velo_percentile"] = item.get("exit_velo_percentile") if item.get("exit_velo_percentile") is not None else calc_empirical_percentile(dist, "avg_exit_velocity", item.get("avg_exit_velocity"), True)
            item["barrel_percentile"] = item.get("barrel_percentile") if item.get("barrel_percentile") is not None else calc_empirical_percentile(dist, "barrel_percentage", item.get("barrel_percentage"), True)
            item["hard_hit_percentile"] = item.get("hard_hit_percentile") if item.get("hard_hit_percentile") is not None else calc_empirical_percentile(dist, "hard_hit_percentage", item.get("hard_hit_percentage"), True)
            item["sweet_spot_percentile"] = item.get("sweet_spot_percentile") if item.get("sweet_spot_percentile") is not None else calc_empirical_percentile(dist, "sweet_spot_percentage", item.get("sweet_spot_percentage"), True)
            item["bat_speed_percentile"] = item.get("bat_speed_percentile") if item.get("bat_speed_percentile") is not None else calc_empirical_percentile(dist, "bat_speed", item.get("bat_speed"), True)
            item["squared_up_percentile"] = item.get("squared_up_percentile") if item.get("squared_up_percentile") is not None else calc_empirical_percentile(dist, "squared_up_percentage", item.get("squared_up_percentage"), True)
            item["chase_percentile"] = item.get("chase_percentile") if item.get("chase_percentile") is not None else calc_empirical_percentile(dist, "chase_percentage", item.get("chase_percentage"), False)
            item["whiff_percentile"] = item.get("whiff_percentile") if item.get("whiff_percentile") is not None else calc_empirical_percentile(dist, "whiff_percentage", item.get("whiff_percentage"), False)
            item["k_percentile"] = item.get("k_percentile") if item.get("k_percentile") is not None else calc_empirical_percentile(dist, "k_percentage", item.get("k_percentage"), False)
            item["bb_percentile"] = item.get("bb_percentile") if item.get("bb_percentile") is not None else calc_empirical_percentile(dist, "bb_percentage", item.get("bb_percentage"), True)

            # 3) Fielding & Running & Catching 지표
            item["arm_strength_percentile"] = item.get("arm_strength_percentile") if item.get("arm_strength_percentile") is not None else calc_empirical_percentile(dist, "arm_strength", item.get("arm_strength"), True)
            item["sprint_speed_percentile"] = item.get("sprint_speed_percentile") if item.get("sprint_speed_percentile") is not None else calc_empirical_percentile(dist, "sprint_speed", item.get("sprint_speed"), True)

            item["blocks_above_average_percentile"] = item.get("blocks_above_average_percentile") if item.get("blocks_above_average_percentile") is not None else calc_empirical_percentile(dist, "blocks_above_average", item.get("blocks_above_average"), True)
            item["cs_above_average_percentile"] = item.get("cs_above_average_percentile") if item.get("cs_above_average_percentile") is not None else calc_empirical_percentile(dist, "cs_above_average", item.get("cs_above_average"), True)
            item["framing_runs_percentile"] = item.get("framing_runs_percentile") if item.get("framing_runs_percentile") is not None else calc_empirical_percentile(dist, "framing_runs", item.get("framing_runs"), True)
            # 팝타임(pop_time)은 초 단위이므로 낮을수록 상위 백분위(higher_is_better=False)
            item["pop_time_percentile"] = item.get("pop_time_percentile") if item.get("pop_time_percentile") is not None else calc_empirical_percentile(dist, "pop_time", item.get("pop_time"), False)

            batting_stats.append(item)
        else:
            # 투수 Value & Pitching 전체 지표 (구종별 Run Value, 피xBA, GB%, Extension 포함)
            item["pitching_run_value_percentile"] = item.get("pitching_run_value_percentile") if item.get("pitching_run_value_percentile") is not None else calc_empirical_percentile(dist, "pitching_run_value", item.get("pitching_run_value"), True)
            item["fastball_run_value_percentile"] = item.get("fastball_run_value_percentile") if item.get("fastball_run_value_percentile") is not None else calc_empirical_percentile(dist, "fastball_run_value", item.get("fastball_run_value"), True)
            item["breaking_run_value_percentile"] = item.get("breaking_run_value_percentile") if item.get("breaking_run_value_percentile") is not None else calc_empirical_percentile(dist, "breaking_run_value", item.get("breaking_run_value"), True)
            item["offspeed_run_value_percentile"] = item.get("offspeed_run_value_percentile") if item.get("offspeed_run_value_percentile") is not None else calc_empirical_percentile(dist, "offspeed_run_value", item.get("offspeed_run_value"), True)

            item["xwoba_percentile"] = item.get("xwoba_percentile") if item.get("xwoba_percentile") is not None else calc_empirical_percentile(dist, "xera", item.get("xera"), False)
            item["xba_percentile"] = item.get("xba_percentile") if item.get("xba_percentile") is not None else calc_empirical_percentile(dist, "xba", item.get("xba"), False)  # 투수 피xBA는 낮을수록 우수!
            item["fastball_velo_percentile"] = item.get("fastball_velo_percentile") if item.get("fastball_velo_percentile") is not None else calc_empirical_percentile(dist, "fastball_velocity", item.get("fastball_velocity"), True)
            item["exit_velo_percentile"] = item.get("exit_velo_percentile") if item.get("exit_velo_percentile") is not None else calc_empirical_percentile(dist, "avg_exit_velocity", item.get("avg_exit_velocity"), False)
            item["chase_percentile"] = item.get("chase_percentile") if item.get("chase_percentile") is not None else calc_empirical_percentile(dist, "chase_percentage", item.get("chase_percentage"), True)
            item["whiff_percentile"] = item.get("whiff_percentile") if item.get("whiff_percentile") is not None else calc_empirical_percentile(dist, "whiff_percentage", item.get("whiff_percentage"), True)
            item["k_percentile"] = item.get("k_percentile") if item.get("k_percentile") is not None else calc_empirical_percentile(dist, "k_percentage", item.get("k_percentage"), True)
            item["bb_percentile"] = item.get("bb_percentile") if item.get("bb_percentile") is not None else calc_empirical_percentile(dist, "bb_percentage", item.get("bb_percentage"), False)
            item["barrel_percentile"] = item.get("barrel_percentile") if item.get("barrel_percentile") is not None else calc_empirical_percentile(dist, "barrel_percentage", item.get("barrel_percentage"), False)
            item["hard_hit_percentile"] = item.get("hard_hit_percentile") if item.get("hard_hit_percentile") is not None else calc_empirical_percentile(dist, "hard_hit_percentage", item.get("hard_hit_percentage"), False)
            item["gb_percentile"] = item.get("gb_percentile") if item.get("gb_percentile") is not None else calc_empirical_percentile(dist, "gb_percentage", item.get("gb_percentage"), True)
            item["extension_percentile"] = item.get("extension_percentile") if item.get("extension_percentile") is not None else calc_empirical_percentile(dist, "pitch_extension", item.get("pitch_extension"), True)

            pitching_stats.append(item)

    available_seasons = sorted(list(seasons_set), reverse=True)

    pos = str(player.get("position") or "").upper()
    if "P" in pos and pitching_stats:
        default_mode = "pitching"
    elif batting_stats:
        default_mode = "batting"
    elif pitching_stats:
        default_mode = "pitching"
    else:
        default_mode = "batting"

    # ★ 가장 최근 시즌(all_stats는 season DESC 정렬됨)의 소속팀을 최우선으로 사용 (맥스 프리드 등 이적생 완벽 대응)
    latest_team_id = player["team_id"]
    latest_team_name = player["team_name"]
    latest_team_code = player["team_code"]

    if all_stats:
        most_recent = all_stats[0]
        if most_recent.get("season_team_id"):
            latest_team_id = most_recent["season_team_id"]
            latest_team_name = most_recent["season_team_name"]
            latest_team_code = most_recent["season_team_code"]

    hw_info = format_height_weight(player.get("height"), player.get("weight"))

    return {
        "player_id": player["player_id"],
        "player_name": player["player_name"],
        "headshot_url": player["headshot_url"],
        "jersey_number": player["jersey_number"] or "-",
        "position": player["position"] or "-",
        "birth_date": str(player["birth_date"]) if player["birth_date"] else "-",
        "age": calculate_age(player["birth_date"]),
        "bats": player["bats"] or "-",
        "throws": player["throws"] or "-",
        "bt": f"{player['bats'] or '-'}/{player['throws'] or '-'}",
        "height_display": hw_info["height_display"],
        "weight_display": hw_info["weight_display"],
        "physical_display": hw_info["physical_display"],
        "team_id": latest_team_id,
        "team_name": latest_team_name,
        "team_code": latest_team_code,
        "default_mode": default_mode,
        "available_seasons": available_seasons,
        "has_batting": len(batting_stats) > 0,
        "has_pitching": len(pitching_stats) > 0,
        "batting_stats": batting_stats,
        "pitching_stats": pitching_stats
    }

from services.player_dl_predictor import dl_predictor

@router.get("/{player_id}/predict-dl")
def predict_player_stats_dl(
    player_id: int,
    target_season: int = 2027,
    mode: str = "batting",
    scenario: str = "normal",
    db: Session = Depends(get_session),
):
    """
    PyTorch 딥러닝(MLP) 모델을 활용한 선수 시즌 성적 예측 및 백테스트 시뮬레이터 API
    """
    try:
        return dl_predictor.predict_player_season(
            db=db,
            player_id=player_id,
            target_season=target_season,
            mode=mode,
            scenario=scenario,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DL 성적 예측 오류: {e}")