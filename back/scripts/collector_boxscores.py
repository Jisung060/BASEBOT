import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Connection": "keep-alive",
}


def create_resilient_session() -> requests.Session:
    """
    TCP/SSL 연결을 재사용(Keep-Alive)하고, 타임아웃이나 일시적 서버 오류 시
    자동으로 3회 백오프 재시도하는 고신뢰성 HTTP 세션 생성
    """
    session = requests.Session()
    session.headers.update(HEADERS)
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.6,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(pool_connections=10, pool_maxsize=10, max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


HTTP_SESSION = create_resilient_session()


def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def parse_innings_pitched(ip_str: Any) -> float:
    if ip_str is None or str(ip_str).strip() == "":
        return 0.0
    try:
        return round(float(ip_str), 1)
    except (ValueError, TypeError):
        return 0.0


def parse_batting_order(raw_bo: Any) -> Optional[int]:
    """선발 출장 타자('100'~'900', 100의 배수)는 1~9로, 교체 투입('101' 등)은 None으로 구분"""
    if raw_bo is None:
        return None
    s = str(raw_bo).strip()
    if not s.isdigit():
        return None
    val = int(s)
    if val >= 100 and val % 100 == 0:
        return val // 100
    if 1 <= val <= 9:
        return val
    return None


def format_linescore_list(raw_linescore: Any) -> list[dict[str, Any]]:
    """프론트엔드 호환 배열([{"inning": 1, "away": 0, "home": 1}, ...])로 변환"""
    if isinstance(raw_linescore, list):
        return raw_linescore
    if not isinstance(raw_linescore, dict):
        return []

    innings = raw_linescore.get("innings") or []
    linescore_list = []
    for inn in innings:
        inn_num = inn.get("num")
        away_info = inn.get("away") or {}
        home_info = inn.get("home") or {}

        a_runs = safe_int(away_info.get("runs", 0))
        h_runs = None
        if "runs" in home_info and home_info.get("runs") is not None:
            h_runs = safe_int(home_info.get("runs"))

        linescore_list.append({
            "inning": inn_num,
            "away": a_runs,
            "home": h_runs,
        })
    return linescore_list


def repair_dict_linescores_in_db():
    """DB에 dict 형태로 잘못 저장되어 있던 linescore를 배열 포맷으로 즉시 일괄 복구"""
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT game_id, linescore FROM games WHERE linescore IS NOT NULL")
        ).mappings().all()

        fixed_cnt = 0
        for r in rows:
            raw_ls = r["linescore"]
            if not raw_ls:
                continue
            try:
                parsed = json.loads(raw_ls) if isinstance(raw_ls, str) else raw_ls
            except Exception:
                continue

            if isinstance(parsed, dict):
                converted = format_linescore_list(parsed)
                conn.execute(
                    text("UPDATE games SET linescore = :ls WHERE game_id = :gid"),
                    {"ls": json.dumps(converted, ensure_ascii=False), "gid": r["game_id"]},
                )
                fixed_cnt += 1

        if fixed_cnt > 0:
            print(f" -> [DB 보정] 딕셔너리 형태 linescore {fixed_cnt}건을 리스트 형식으로 즉시 변환 완료!")


def fetch_single_game_feed(game_id: int) -> Optional[dict[str, Any]]:
    """
    단 1번의 API 호출(/feed/live)로 boxscore와 linescore를 동시에 가져오며,
    Keep-Alive 세션과 자동 재시도(3회)로 ConnectTimeoutError를 원천 방지합니다.
    """
    url = f"https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live"
    try:
        resp = HTTP_SESSION.get(url, timeout=(6, 15))
        if resp.status_code != 200:
            return None
        live_data = resp.json().get("liveData") or {}
        return {
            "game_id": int(game_id),
            "boxscore": live_data.get("boxscore") or {},
            "linescore": live_data.get("linescore") or {},
        }
    except Exception as e:
        print(f"※ game_id={game_id} 재시도 후에도 호출 실패: {e}")
        return None


def extract_game_records(feed: dict[str, Any], valid_teams: set[int]) -> tuple[Optional[str], list[dict], list[dict]]:
    game_id = feed["game_id"]
    box = feed.get("boxscore") or {}
    line = feed.get("linescore") or {}

    ls_list = format_linescore_list(line)
    linescore_json = json.dumps(ls_list, ensure_ascii=False) if ls_list else None

    players_to_upsert: dict[int, dict] = {}
    boxscore_rows: list[dict] = []

    teams_node = box.get("teams") or {}
    for side in ("away", "home"):
        side_data = teams_node.get(side) or {}
        team_info = side_data.get("team") or {}
        team_id = int(team_info.get("id") or 0)
        if team_id not in valid_teams:
            continue

        players_dict = side_data.get("players") or {}
        batters_ids = [int(x) for x in (side_data.get("batters") or []) if str(x).isdigit()]
        pitchers_ids = [int(x) for x in (side_data.get("pitchers") or []) if str(x).isdigit()]

        active_pids = list(dict.fromkeys(batters_ids + pitchers_ids))

        for pid in active_pids:
            p_key = f"ID{pid}"
            p_entry = players_dict.get(p_key) or {}
            person = p_entry.get("person") or {}
            full_name = person.get("fullName")
            if not full_name:
                continue

            pos_info = p_entry.get("position") or {}
            pos_abbr = pos_info.get("abbreviation") or "P"
            jersey_num = p_entry.get("jerseyNumber")

            stats_node = p_entry.get("stats") or {}
            bat_stat = stats_node.get("batting") or {}
            pit_stat = stats_node.get("pitching") or {}

            raw_bo = p_entry.get("battingOrder") or bat_stat.get("battingOrder")
            batting_order = parse_batting_order(raw_bo)

            has_batting = bool(bat_stat) and (
                batting_order is not None
                or safe_int(bat_stat.get("plateAppearances", 0)) > 0
                or safe_int(bat_stat.get("atBats", 0)) > 0
                or safe_int(bat_stat.get("baseOnBalls", 0)) > 0
                or safe_int(bat_stat.get("runs", 0)) > 0
            )
            ip_val = parse_innings_pitched(pit_stat.get("inningsPitched"))
            pitches_val = safe_int(
                pit_stat.get("numberOfPitches")
                or pit_stat.get("pitchesThrown")
                or pit_stat.get("pitches")
                or 0
            )
            bf_val = safe_int(pit_stat.get("battersFaced", 0))
            has_pitching = (pid in pitchers_ids) and (ip_val > 0 or pitches_val > 0 or bf_val > 0 or bool(pit_stat))

            if not has_batting and not has_pitching:
                continue

            players_to_upsert[pid] = {
                "player_id": pid,
                "team_id": team_id,
                "player_name": full_name,
                "jersey_number": str(jersey_num) if jersey_num else None,
                "position": str(pos_abbr)[:10] if pos_abbr else None,
                "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
            }

            if has_pitching and not has_batting:
                final_pos = "P"
                final_bo = None
            else:
                final_pos = str(pos_abbr)[:10] if pos_abbr else ("P" if has_pitching else "DH")
                final_bo = batting_order

            boxscore_rows.append({
                "game_id": game_id,
                "player_id": pid,
                "team_id": team_id,
                "position": final_pos,
                "batting_order": final_bo,
                "at_bats": safe_int(bat_stat.get("atBats", 0)),
                "hits": safe_int(bat_stat.get("hits", 0)),
                "home_runs": safe_int(bat_stat.get("homeRuns", 0)),
                "rbi": safe_int(bat_stat.get("rbi", 0)),
                "walks": safe_int(bat_stat.get("baseOnBalls", 0)),
                "strikeouts": safe_int(bat_stat.get("strikeOuts", 0)),
                "innings_pitched": ip_val if has_pitching else 0.0,
                "earned_runs": safe_int(pit_stat.get("earnedRuns", 0)) if has_pitching else 0,
                "runs_allowed": safe_int(pit_stat.get("runs", 0)) if has_pitching else 0,
                "hits_allowed": safe_int(pit_stat.get("hits", 0)) if has_pitching else 0,
                "strikeouts_pitched": safe_int(pit_stat.get("strikeOuts", 0)) if has_pitching else 0,
                "pitch_count": pitches_val if has_pitching else 0,
            })

    return linescore_json, list(players_to_upsert.values()), boxscore_rows


def _save_feeds_to_db(feeds: list[dict[str, Any]], valid_teams: set[int]) -> int:
    upsert_player_sql = text("""
        INSERT INTO players (player_id, team_id, player_name, jersey_number, position, headshot_url)
        VALUES (:player_id, :team_id, :player_name, :jersey_number, :position, :headshot)
        ON DUPLICATE KEY UPDATE
            player_name = COALESCE(players.player_name, VALUES(player_name)),
            jersey_number = COALESCE(players.jersey_number, VALUES(jersey_number)),
            position = COALESCE(players.position, VALUES(position)),
            headshot_url = COALESCE(players.headshot_url, VALUES(headshot_url))
    """)

    insert_box_sql = text("""
        INSERT INTO game_boxscores (
            game_id, player_id, team_id, position, batting_order,
            at_bats, hits, home_runs, rbi, walks, strikeouts,
            innings_pitched, earned_runs, runs_allowed, hits_allowed,
            strikeouts_pitched, pitch_count
        ) VALUES (
            :game_id, :player_id, :team_id, :position, :batting_order,
            :at_bats, :hits, :home_runs, :rbi, :walks, :strikeouts,
            :innings_pitched, :earned_runs, :runs_allowed, :hits_allowed,
            :strikeouts_pitched, :pitch_count
        )
    """)

    total_box_rows = 0
    with engine.begin() as conn:
        for feed in feeds:
            gid = feed["game_id"]
            linescore_json, new_players, box_rows = extract_game_records(feed, valid_teams)

            if linescore_json:
                conn.execute(
                    text("UPDATE games SET linescore = :ls WHERE game_id = :gid"),
                    {"ls": linescore_json, "gid": gid},
                )

            if new_players:
                conn.execute(upsert_player_sql, new_players)

            if box_rows:
                conn.execute(text("DELETE FROM game_boxscores WHERE game_id = :gid"), {"gid": gid})
                conn.execute(insert_box_sql, box_rows)
                total_box_rows += len(box_rows)
    return total_box_rows


def repair_incomplete_games(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    ★ 타임아웃이나 과거 스크립트 버그로 인해:
    1) linescore가 비어 있거나
    2) game_boxscores 등록 선수가 18명 미만(투수 누락 등)인 종료 경기만 콕 집어서 초고속 복구!
    """
    repair_dict_linescores_in_db()

    date_filter = "AND DATE(g.game_date) BETWEEN :s AND :e" if (start_date and end_date) else ""
    params = {"s": start_date, "e": end_date} if (start_date and end_date) else {}

    with engine.connect() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())
        incomplete_gids = conn.execute(
            text(f"""
                SELECT g.game_id
                FROM games g
                LEFT JOIN game_boxscores b ON g.game_id = b.game_id
                WHERE g.status = 'FINAL'
                  {date_filter}
                GROUP BY g.game_id, g.linescore
                HAVING g.linescore IS NULL
                    OR COUNT(b.boxscore_id) < 18
                    OR SUM(CASE WHEN b.innings_pitched > 0 THEN 1 ELSE 0 END) = 0
                ORDER BY g.game_id ASC
            """),
            params,
        ).scalars().all()

    target_ids = [int(x) for x in incomplete_gids]
    if not target_ids:
        print(" -> [무결성 확인 완료] 선수 박스스코어나 투수 기록이 누락된 경기가 0건입니다!")
        return 0

    print(f" -> [타깃 복구] 타임아웃/누락으로 박스스코어가 불완전한 {len(target_ids)}경기를 발견했습니다: {target_ids[:10]}...")
    feeds = []
    # MLB 서버 연결 거부 방지를 위해 max_workers=4 + Keep-Alive 세션 사용
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(fetch_single_game_feed, gid): gid for gid in target_ids}
        for future in as_completed(future_map):
            res = future.result()
            if res:
                feeds.append(res)

    saved_rows = _save_feeds_to_db(feeds, valid_teams)
    print(f" -> [타깃 복구 완료] 누락 경기 {len(feeds)}건 (총 {saved_rows}명 선수 기록) 완벽 복구!")
    return len(feeds)


def run_boxscore_collector(
    start_date: str = "2024-04-01",
    end_date: str = "2024-04-30",
    game_id: Optional[int] = None,
    only_incomplete: bool = False,
):
    print("========================================================")
    print(f"박스스코어 및 라인스코어 정밀 수집기 가동 ({start_date} ~ {end_date})")
    print("========================================================")

    repair_dict_linescores_in_db()

    if only_incomplete:
        repair_incomplete_games(start_date, end_date)
        return

    # 먼저 해당 기간 내 불완전/타임아웃 누락 경기부터 우선 복구
    repair_incomplete_games(start_date, end_date)

    with engine.connect() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())
        if game_id:
            target_games = [int(game_id)]
        else:
            # 이미 완전하게(타자+투수 18명 이상 & linescore 보유) 들어있는 경기는 건너뛰고 부족한 경기만 수집
            rows = conn.execute(
                text("""
                    SELECT g.game_id
                    FROM games g
                    LEFT JOIN game_boxscores b ON g.game_id = b.game_id
                    WHERE DATE(g.game_date) BETWEEN :s AND :e
                      AND g.status = 'FINAL'
                    GROUP BY g.game_id, g.linescore
                    HAVING g.linescore IS NULL
                        OR COUNT(b.boxscore_id) < 18
                        OR SUM(CASE WHEN b.innings_pitched > 0 THEN 1 ELSE 0 END) = 0
                    ORDER BY g.game_id ASC
                """),
                {"s": start_date, "e": end_date},
            ).scalars().all()
            target_games = [int(gid) for gid in rows]

    if not target_games:
        print(f" -> [{start_date} ~ {end_date}] 모든 종료 경기의 박스스코어(타자·투수 전원)와 라인스코어가 이미 100% 완비되어 있습니다!")
        return

    print(f" -> 추가 보강이 필요한 {len(target_games)}경기 다운로드 중 (max_workers=4, Keep-Alive)...")
    feeds = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(fetch_single_game_feed, gid): gid for gid in target_games}
        for future in as_completed(future_map):
            res = future.result()
            if res:
                feeds.append(res)

    total_box_rows = _save_feeds_to_db(feeds, valid_teams)
    print(f">>> 박스스코어 수집 완료! ({len(feeds)}경기, 총 {total_box_rows}명의 타자·투수 기록 적재 성공)")


if __name__ == "__main__":
    # 단독 실행 시 DB 전체에서 타임아웃/누락으로 인해 불완전했던 모든 경기를 자동으로 찾아 100% 복구합니다!
    repair_incomplete_games()