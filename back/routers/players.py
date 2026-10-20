from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_session
import re

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
                      SELECT p.player_id,
                             p.player_name,
                             p.player_name_ko,
                             p.headshot_url,
                             p.position,
                             p.throws,
                             t.team_name,
                             t.team_code,
                             (SELECT MAX(s.season)
                              FROM player_season_stats s
                              WHERE s.player_id = p.player_id) AS latest_season
                      FROM players p
                               LEFT JOIN teams t ON p.team_id = t.team_id
                      WHERE p.player_name LIKE :kw
                         OR p.player_name_ko LIKE :kw
                         OR t.team_name LIKE :kw
                         OR t.team_code LIKE :kw
                      ORDER BY CASE
                                   WHEN p.player_name_ko LIKE :starts THEN 0
                                   WHEN p.player_name LIKE :starts THEN 1
                                   ELSE 2
                                   END,
                               p.player_name ASC LIMIT :limit
                      """)

    players = db.execute(
        player_sql,
        {
            "kw": like_pattern,
            "starts": starts_pattern,
            "limit": max(1, min(limit, 50)),
        },
    ).mappings().all()

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

            # 자동완성 화면에 표시할 이름
            "name": p["player_name_ko"] or p["player_name"],

            # 원본 및 한국어 이름 모두 제공
            "name_ko": p["player_name_ko"],
            "name_en": p["player_name"],

            "image_url": (
                    p["headshot_url"]
                    or "https://img.mlbstatic.com/mlb-photos/image/upload/"
                       "w_213,q_auto:best/v1/people/generic/headshot/67/current"
            ),

            "subtext": (
                f"MLB | "
                f"{p['latest_season'] or '-'} | "
                f"{pos} | "
                f"{short_team}"
            ),
        })

    return {"results": results}


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

        # 해당 시즌 주전급(Qualified) 선수 분포를 기준으로 모든 지표 백분위를 일관성 있게 산출
        dist = get_season_distribution(db, season_yr, is_pit)

        if not is_pit:
            # 1) Value 지표
            item["batting_run_value_percentile"] = item.get("batting_run_value_percentile") or calc_empirical_percentile(dist, "batting_run_value", item.get("batting_run_value"), True)
            if item.get("baserunning_run_value") is not None:
                bsr_val = float(item["baserunning_run_value"])
                if bsr_val == 0 and item.get("sprint_speed") is not None and float(item["sprint_speed"]) < 26.5:
                    item["baserunning_run_value_percentile"] = max(15, min(45, calc_empirical_percentile(dist, "baserunning_run_value", -0.5, True) or 35))
                else:
                    item["baserunning_run_value_percentile"] = item.get("baserunning_run_value_percentile") or calc_empirical_percentile(dist, "baserunning_run_value", bsr_val, True)
            item["oaa_percentile"] = item.get("oaa_percentile") or calc_empirical_percentile(dist, "outs_above_average", item.get("outs_above_average"), True)
            # 1) Value & Fielding 지표
            item["fielding_run_value_percentile"] = (
                item.get("fielding_run_value_percentile")
                or calc_empirical_percentile(dist, "fielding_run_value", item.get("fielding_run_value"), True)
            )
            item["arm_value_percentile"] = (
                item.get("arm_value_percentile")
                or calc_empirical_percentile(dist, "arm_value", item.get("arm_value"), True)
            )

            # 2) Batting 지표 (Bat Speed & Squared-Up% 포함)
            item["xwoba_percentile"] = calc_empirical_percentile(dist, "xwoba", item.get("xwoba"), True)
            item["xba_percentile"] = calc_empirical_percentile(dist, "xba", item.get("xba"), True)
            item["xslg_percentile"] = calc_empirical_percentile(dist, "xslg", item.get("xslg"), True)
            item["exit_velo_percentile"] = calc_empirical_percentile(dist, "avg_exit_velocity", item.get("avg_exit_velocity"), True)
            item["barrel_percentile"] = calc_empirical_percentile(dist, "barrel_percentage", item.get("barrel_percentage"), True)
            item["hard_hit_percentile"] = calc_empirical_percentile(dist, "hard_hit_percentage", item.get("hard_hit_percentage"), True)
            item["sweet_spot_percentile"] = calc_empirical_percentile(dist, "sweet_spot_percentage", item.get("sweet_spot_percentage"), True)
            item["bat_speed_percentile"] = item.get("bat_speed_percentile") or calc_empirical_percentile(dist, "bat_speed", item.get("bat_speed"), True)
            item["squared_up_percentile"] = item.get("squared_up_percentile") or calc_empirical_percentile(dist, "squared_up_percentage", item.get("squared_up_percentage"), True)
            item["chase_percentile"] = calc_empirical_percentile(dist, "chase_percentage", item.get("chase_percentage"), False)
            item["whiff_percentile"] = calc_empirical_percentile(dist, "whiff_percentage", item.get("whiff_percentage"), False)
            item["k_percentile"] = calc_empirical_percentile(dist, "k_percentage", item.get("k_percentage"), False)
            item["bb_percentile"] = calc_empirical_percentile(dist, "bb_percentage", item.get("bb_percentage"), True)

            # 3) Fielding & Running & Catching 지표
            item["arm_strength_percentile"] = item.get("arm_strength_percentile") or calc_empirical_percentile(dist, "arm_strength", item.get("arm_strength"), True)
            item["sprint_speed_percentile"] = item.get("sprint_speed_percentile") or calc_empirical_percentile(dist, "sprint_speed", item.get("sprint_speed"), True)

            item["blocks_above_average_percentile"] = item.get("blocks_above_average_percentile") or calc_empirical_percentile(dist, "blocks_above_average", item.get("blocks_above_average"), True)
            item["cs_above_average_percentile"] = item.get("cs_above_average_percentile") or calc_empirical_percentile(dist, "cs_above_average", item.get("cs_above_average"), True)
            item["framing_runs_percentile"] = item.get("framing_runs_percentile") or calc_empirical_percentile(dist, "framing_runs", item.get("framing_runs"), True)
            # 팝타임(pop_time)은 초 단위이므로 낮을수록 상위 백분위(higher_is_better=False)
            item["pop_time_percentile"] = item.get("pop_time_percentile") or calc_empirical_percentile(dist, "pop_time", item.get("pop_time"), False)

            batting_stats.append(item)
        else:
            # 투수 Value & Pitching 전체 지표 (구종별 Run Value, 피xBA, GB%, Extension 포함)
            item["pitching_run_value_percentile"] = item.get("pitching_run_value_percentile") or calc_empirical_percentile(dist, "pitching_run_value", item.get("pitching_run_value"), True)
            item["fastball_run_value_percentile"] = item.get("fastball_run_value_percentile") or calc_empirical_percentile(dist, "fastball_run_value", item.get("fastball_run_value"), True)
            item["breaking_run_value_percentile"] = item.get("breaking_run_value_percentile") or calc_empirical_percentile(dist, "breaking_run_value", item.get("breaking_run_value"), True)
            item["offspeed_run_value_percentile"] = item.get("offspeed_run_value_percentile") or calc_empirical_percentile(dist, "offspeed_run_value", item.get("offspeed_run_value"), True)

            item["xwoba_percentile"] = calc_empirical_percentile(dist, "xera", item.get("xera"), False)
            item["xba_percentile"] = calc_empirical_percentile(dist, "xba", item.get("xba"), False)  # 투수 피xBA는 낮을수록 우수!
            item["fastball_velo_percentile"] = item.get("fastball_velo_percentile") or calc_empirical_percentile(dist, "fastball_velocity", item.get("fastball_velocity"), True)
            item["exit_velo_percentile"] = calc_empirical_percentile(dist, "avg_exit_velocity", item.get("avg_exit_velocity"), False)
            item["chase_percentile"] = calc_empirical_percentile(dist, "chase_percentage", item.get("chase_percentage"), True)
            item["whiff_percentile"] = calc_empirical_percentile(dist, "whiff_percentage", item.get("whiff_percentage"), True)
            item["k_percentile"] = calc_empirical_percentile(dist, "k_percentage", item.get("k_percentage"), True)
            item["bb_percentile"] = calc_empirical_percentile(dist, "bb_percentage", item.get("bb_percentage"), False)
            item["barrel_percentile"] = calc_empirical_percentile(dist, "barrel_percentage", item.get("barrel_percentage"), False)
            item["hard_hit_percentile"] = calc_empirical_percentile(dist, "hard_hit_percentage", item.get("hard_hit_percentage"), False)
            item["gb_percentile"] = item.get("gb_percentile") or calc_empirical_percentile(dist, "gb_percentage", item.get("gb_percentage"), True)
            item["extension_percentile"] = item.get("extension_percentile") or calc_empirical_percentile(dist, "pitch_extension", item.get("pitch_extension"), True)

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