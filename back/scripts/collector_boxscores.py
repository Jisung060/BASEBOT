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
    """Keep-Alive 및 자동 재시도(3회)가 적용된 HTTP 세션"""
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


def parse_mlb_batting_order(raw_bo: Any) -> Optional[int]:
    """
    ★ MLB API 원본 battingOrder 정수값을 그대로 보존합니다!
    - 선발 타자: 100, 200, 300, ..., 900 (100으로 나누어떨어짐)
    - 대타 / 대주자 / 대수비 교체 선수: 101, 102, 201, 301 등 (끝자리가 01, 02...)
      -> 백엔드/프론트엔드에서:
         * `batting_order % 100 == 0` 이면 선발 라인업 (타순: `batting_order // 100`)
         * `batting_order % 100 > 0` 이면 해당 타순(`batting_order // 100`)에 교체 투입된 대타/대주자/대수비!
    """
    if raw_bo is None:
        return None
    s = str(raw_bo).strip()
    if not s.isdigit():
        return None
    return int(s)


def resolve_player_position(p_entry: dict[str, Any], batting_order: Optional[int], has_pitching: bool, has_batting: bool) -> str:
    """
    allPositions 배열을 참조하여 대타(PH)/대주자(PR) 및 복합 포지션(예: PH-LF, PR-2B)을
    MLB 공식 박스스코어 스타일로 보존
    """
    if has_pitching and not has_batting:
        return "P"

    all_pos = p_entry.get("allPositions") or []
    abbrs = []
    for pos_obj in all_pos:
        ab = pos_obj.get("abbreviation")
        if ab and ab not in abbrs:
            abbrs.append(str(ab))

    if abbrs:
        # 예: 대타로 나와 좌익수를 본 경우 "PH-LF", 대주자면 "PR", 단일 포지션이면 "CF"
        joined = "-".join(abbrs)
        return joined[:10]

    pos_info = p_entry.get("position") or {}
    pos_abbr = pos_info.get("abbreviation")
    if pos_abbr:
        return str(pos_abbr)[:10]

    return "P" if has_pitching else "DH"


def fetch_single_game_feed(game_id: int) -> Optional[dict[str, Any]]:
    """단일 경기의 MLB 공식 /feed/live 데이터 조회"""
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
        print(f"※ game_id={game_id} API 호출 실패: {e}")
        return None


def extract_game_records(feed: dict[str, Any], valid_teams: set[int]) -> tuple[Optional[str], list[dict], list[dict]]:
    """
    1) linescore: MLB API 공식 원본 딕셔너리(dict) 그대로 JSON 직렬화
    2) players_to_upsert: 누락 방지를 위한 출전 선수 프로필
    3) boxscore_rows: MLB 공식 battingOrder(100~900 및 대타/대주자 101~909)와 포지션(PH, PR 등)이 보존된 박스스코어
    """
    game_id = feed["game_id"]
    box = feed.get("boxscore") or {}
    line = feed.get("linescore") or {}

    # ★ 핵심 1: 가공하지 않은 MLB API 공식 linescore 딕셔너리 객체 그대로 JSON 저장!
    linescore_json = json.dumps(line, ensure_ascii=False) if (isinstance(line, dict) and line) else None

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
            primary_pos_abbr = pos_info.get("abbreviation") or "P"
            jersey_num = p_entry.get("jerseyNumber")

            stats_node = p_entry.get("stats") or {}
            bat_stat = stats_node.get("batting") or {}
            pit_stat = stats_node.get("pitching") or {}

            raw_bo = p_entry.get("battingOrder") or bat_stat.get("battingOrder")
            batting_order = parse_mlb_batting_order(raw_bo)

            has_batting = bool(bat_stat) and (
                batting_order is not None
                or safe_int(bat_stat.get("plateAppearances", 0)) > 0
                or safe_int(bat_stat.get("atBats", 0)) > 0
                or safe_int(bat_stat.get("baseOnBalls", 0)) > 0
                or safe_int(bat_stat.get("runs", 0)) > 0
                or (pid in batters_ids and not (pid in pitchers_ids and batting_order is None))
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
                "position": str(primary_pos_abbr)[:10] if primary_pos_abbr else None,
                "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
            }

            final_pos = resolve_player_position(p_entry, batting_order, has_pitching, has_batting)
            final_bo = None if (has_pitching and not has_batting) else batting_order

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


def run_boxscore_collector(
    start_date: str = "2024-04-01",
    end_date: str = "2024-04-30",
    game_id: Optional[int] = None,
    force_refresh: bool = True,
):
    """
    지정된 기간의 모든 종료 경기에 대해 MLB API 공식 원본 linescore(dict)와
    대타/대주자(battingOrder 101, 301 등 & PH/PR 포지션)가 포함된 박스스코어를 적재합니다.
    """
    print("========================================================")
    print(f"MLB 공식 포맷 박스스코어 & 라인스코어 수집기 가동 ({start_date} ~ {end_date})")
    print("========================================================")

    with engine.connect() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())
        if game_id:
            target_games = [int(game_id)]
        elif force_refresh:
            rows = conn.execute(
                text("""
                    SELECT game_id
                    FROM games
                    WHERE DATE(game_date) BETWEEN :s AND :e
                      AND status = 'FINAL'
                    ORDER BY game_date ASC, game_id ASC
                """),
                {"s": start_date, "e": end_date},
            ).scalars().all()
            target_games = [int(gid) for gid in rows]
        else:
            # linescore가 배열('[') 형태이거나, 박스스코어가 18명 미만이거나, batting_order가 구버전(1~9)인 경기만 선별
            rows = conn.execute(
                text("""
                    SELECT g.game_id
                    FROM games g
                    LEFT JOIN game_boxscores b ON g.game_id = b.game_id
                    WHERE DATE(g.game_date) BETWEEN :s AND :e
                      AND g.status = 'FINAL'
                    GROUP BY g.game_id, g.linescore
                    HAVING g.linescore IS NULL
                        OR LEFT(LTRIM(g.linescore), 1) = '['
                        OR COUNT(b.boxscore_id) < 18
                        OR MAX(COALESCE(b.batting_order, 0)) < 100
                    ORDER BY g.game_id ASC
                """),
                {"s": start_date, "e": end_date},
            ).scalars().all()
            target_games = [int(gid) for gid in rows]

    if not target_games:
        print(" -> 대상 경기가 모두 최신 MLB 공식 포맷으로 적재되어 있습니다.")
        return

    print(f" -> 총 {len(target_games)}경기 MLB 공식 피드 다운로드 중 (max_workers=4, Keep-Alive)...")
    feeds = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(fetch_single_game_feed, gid): gid for gid in target_games}
        for future in as_completed(future_map):
            res = future.result()
            if res:
                feeds.append(res)

    total_box_rows = _save_feeds_to_db(feeds, valid_teams)
    print(f">>> 적재 완료! ({len(feeds)}경기, 총 {total_box_rows}명 선수 기록 및 MLB 공식 linescore 객체 반영)")


def upgrade_all_existing_games_to_mlb_format():
    """
    DB에 이미 저장된 경기들 중 linescore가 배열('[')로 되어 있거나
    대타/대주자 타순(100~901)이 반영되지 않은 경기를 모두 찾아 MLB 공식 포맷으로 일괄 업그레이드!
    """
    with engine.connect() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())
        rows = conn.execute(
            text("""
                SELECT g.game_id
                FROM games g
                LEFT JOIN game_boxscores b ON g.game_id = b.game_id
                WHERE g.status = 'FINAL'
                GROUP BY g.game_id, g.linescore
                HAVING g.linescore IS NULL
                    OR LEFT(LTRIM(g.linescore), 1) = '['
                    OR COUNT(b.boxscore_id) < 18
                    OR MAX(COALESCE(b.batting_order, 0)) < 100
                ORDER BY g.game_id ASC
            """)
        ).scalars().all()
        target_ids = [int(x) for x in rows]

    if not target_ids:
        print(" -> DB 내 모든 종료 경기가 이미 MLB 공식 포맷(linescore dict & 100단위 타순)입니다!")
        return

    print(f" -> [MLB 공식 포맷 일괄 전환] 총 {len(target_ids)}경기를 변환합니다...")
    feeds = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(fetch_single_game_feed, gid): gid for gid in target_ids}
        for future in as_completed(future_map):
            res = future.result()
            if res:
                feeds.append(res)

    saved = _save_feeds_to_db(feeds, valid_teams)
    print(f" -> [전환 완료] {len(feeds)}경기 (선수 {saved}명) MLB 공식 포맷 적용 완료!")


if __name__ == "__main__":
    upgrade_all_existing_games_to_mlb_format()