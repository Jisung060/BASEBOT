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
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def parse_innings_pitched(ip_str: Any) -> float:
    """MLB 이닝 표기('5.1', '6.2' 등)를 숫자형(5.1, 6.2)으로 안전하게 변환"""
    if ip_str is None or str(ip_str).strip() == "":
        return 0.0
    try:
        return round(float(ip_str), 1)
    except (ValueError, TypeError):
        return 0.0


def parse_batting_order(raw_bo: Any) -> Optional[int]:
    """
    MLB Boxscore API의 battingOrder 문자열(예: '100', '200', ..., '900', 대타 '301')을
    타순 번호로 변환:
    - 선발 타자('100', '200', ..., '900') -> 1 ~ 9
    - 교체/대타/대주자('101', '301' 등) -> 101, 301 등 원본 유지 또는 타순 식별 가능하도록 처리
      (단, 선발 9명 라인업 추출을 위해 정밀 파싱)
    """
    if raw_bo is None:
        return None
    s = str(raw_bo).strip()
    if not s.isdigit():
        return None
    val = int(s)
    # '100', '200' ... '900'처럼 끝자리가 00인 경우가 선발 출장 타자(1~9번)
    if val >= 100 and val % 100 == 0:
        return val // 100
    # 이미 1~9로 들어온 경우 그대로 반환, 대타(예: 301)는 1~9 선발과 겹치지 않게 NULL(교체) 또는 구분
    if 1 <= val <= 9:
        return val
    return None


def fetch_single_game_feed(game_id: int) -> Optional[dict[str, Any]]:
    """단일 경기의 linescore + boxscore 통합 피드 조회"""
    box_url = f"https://statsapi.mlb.com/api/v1/game/{game_id}/boxscore"
    line_url = f"https://statsapi.mlb.com/api/v1/game/{game_id}/linescore"

    try:
        b_resp = requests.get(box_url, headers=HEADERS, timeout=15)
        l_resp = requests.get(line_url, headers=HEADERS, timeout=15)
        if b_resp.status_code != 200:
            return None

        box_data = b_resp.json()
        line_data = l_resp.json() if l_resp.status_code == 200 else {}
        return {
            "game_id": int(game_id),
            "boxscore": box_data,
            "linescore": line_data,
        }
    except Exception as e:
        print(f"※ game_id={game_id} 박스스코어 API 호출 실패: {e}")
        return None


def extract_game_records(feed: dict[str, Any], valid_teams: set[int]) -> tuple[Optional[str], list[dict], list[dict]]:
    """
    API 응답에서:
    1) linescore JSON 문자열
    2) 누락 방지를 위한 출전 선수 프로필 목록 (players 테이블 자동 등록용)
    3) 타자 + 투수 전원의 game_boxscores 행 목록
    을 추출합니다.
    """
    game_id = feed["game_id"]
    box = feed.get("boxscore") or {}
    line = feed.get("linescore") or {}

    linescore_json = json.dumps(line, ensure_ascii=False) if line else None
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

        # 이 경기에 실제 출전한 선수 ID 집합 (타석에 섰거나 마운드에 등판한 선수 전원)
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

            # 타석 기록이나 투구 기록이 전혀 없는 벤치 대기 선수(단순 투수 엔트리 제외) 필터링
            has_batting = bool(bat_stat) and (
                batting_order is not None
                or int(bat_stat.get("plateAppearances", 0) or 0) > 0
                or int(bat_stat.get("atBats", 0) or 0) > 0
                or int(bat_stat.get("baseOnBalls", 0) or 0) > 0
                or int(bat_stat.get("runs", 0) or 0) > 0
            )
            ip_val = parse_innings_pitched(pit_stat.get("inningsPitched"))
            pitches_val = int(pit_stat.get("numberOfPitches", 0) or pit_stat.get("pitchesThrown", 0) or 0)
            bf_val = int(pit_stat.get("battersFaced", 0) or 0)
            has_pitching = (pid in pitchers_ids) and (ip_val > 0 or pitches_val > 0 or bf_val > 0 or bool(pit_stat))

            if not has_batting and not has_pitching:
                continue

            # 1) players 테이블 누락 방지용 선수 메타데이터 수집
            players_to_upsert[pid] = {
                "player_id": pid,
                "team_id": team_id,
                "player_name": full_name,
                "jersey_number": str(jersey_num) if jersey_num else None,
                "position": str(pos_abbr)[:10] if pos_abbr else None,
                "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{pid}/headshot/67/current",
            }

            # 2) 투수로 등판한 경우 position이 'P'로 명확히 식별되도록 보장 (오타니 같은 투타겸업 대응)
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
                "at_bats": int(bat_stat.get("atBats", 0) or 0),
                "hits": int(bat_stat.get("hits", 0) or 0),
                "home_runs": int(bat_stat.get("homeRuns", 0) or 0),
                "rbi": int(bat_stat.get("rbi", 0) or 0),
                "walks": int(bat_stat.get("baseOnBalls", 0) or 0),
                "strikeouts": int(bat_stat.get("strikeOuts", 0) or 0),
                "innings_pitched": ip_val if has_pitching else 0.0,
                "earned_runs": int(pit_stat.get("earnedRuns", 0) or 0) if has_pitching else 0,
                "runs_allowed": int(pit_stat.get("runs", 0) or 0) if has_pitching else 0,
                "hits_allowed": int(pit_stat.get("hits", 0) or 0) if has_pitching else 0,
                "strikeouts_pitched": int(pit_stat.get("strikeOuts", 0) or 0) if has_pitching else 0,
                "pitch_count": pitches_val if has_pitching else 0,
            })

    return linescore_json, list(players_to_upsert.values()), boxscore_rows


def run_boxscore_collector(start_date: str = "2024-04-01", end_date: str = "2024-04-30", game_id: Optional[int] = None):
    print("========================================================")
    print(f"박스스코어 및 라인스코어 정밀 수집기 가동 ({start_date} ~ {end_date})")
    print("========================================================")

    with engine.connect() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())
        if game_id:
            target_games = [int(game_id)]
        else:
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

    if not target_games:
        print(" -> 해당 기간에 수집할 종료 경기(FINAL)가 없습니다.")
        return

    print(f" -> 총 {len(target_games)}경기 박스스코어 병렬 다운로드 중...")
    feeds = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_map = {executor.submit(fetch_single_game_feed, gid): gid for gid in target_games}
        for future in as_completed(future_map):
            res = future.result()
            if res:
                feeds.append(res)

    print(f" -> {len(feeds)}경기 API 응답 확보 완료. DB 일괄 적재 시작...")

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

            # ★ 핵심 1: 박스스코어에 등장한 모든 선수를 players 테이블에 먼저 보장 (외래키 누락 0%)
            if new_players:
                conn.execute(upsert_player_sql, new_players)

            # ★ 핵심 2: 기존 불완전했던 해당 경기 박스스코어 행을 지우고 전체 출전 선수 기록을 깨끗하게 재적재
            if box_rows:
                conn.execute(text("DELETE FROM game_boxscores WHERE game_id = :gid"), {"gid": gid})
                conn.execute(insert_box_sql, box_rows)
                total_box_rows += len(box_rows)

    print(f">>> 박스스코어 수집 완료! ({len(feeds)}경기, 총 {total_box_rows}명의 타자·투수 기록 적재 성공)")


if __name__ == "__main__":
    # 단독 실행 시 2024년 4월 초 경기(746170 포함) 즉시 복구 가능
    run_boxscore_collector(start_date="2024-04-01", end_date="2024-04-30")