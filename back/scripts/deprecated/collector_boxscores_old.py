import os
import sys
import time
import json
from pathlib import Path

# 모듈 검색 경로에 back 폴더 추가
BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import requests
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def safe_int(val, default=0):
    try:
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default

def safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (ValueError, TypeError):
        return default

def extract_linescore_data(live_linescore, game_id: int):
    """
    이닝별 라인스코어 추출 (feed/live에서 누락 시 전용 API fallback 호출)
    """
    innings = live_linescore.get("innings", [])

    # 만약 feed/live에 이닝 정보가 비어있다면 공식 linescore 전용 엔드포인트 호출
    if not innings:
        try:
            ls_url = f"https://statsapi.mlb.com/api/v1/game/{game_id}/linescore"
            ls_resp = requests.get(ls_url, headers=HEADERS, timeout=10)
            if ls_resp.status_code == 200:
                innings = ls_resp.json().get("innings", [])
        except Exception as e:
            print(f"    ! [Game {game_id}] Linescore Fallback 실패: {e}")

    linescore_list = []
    for inn in innings:
        inn_num = inn.get("num")
        away_info = inn.get("away", {})
        home_info = inn.get("home", {})

        # 원정팀 득점
        a_runs = safe_int(away_info.get("runs", 0))

        # 홈팀 득점 (9회말 미진행인 경우 runs 키가 없거나 null일 수 있음 -> None 유지 또는 스킵)
        h_runs = None
        if "runs" in home_info and home_info.get("runs") is not None:
            h_runs = safe_int(home_info.get("runs"))

        linescore_list.append({
            "inning": inn_num,
            "away": a_runs,
            "home": h_runs  # 9회말 공격 안 한 경우 null (화면에서 'X'로 표기 가능)
        })

    return linescore_list

def collect_boxscore_and_linescore(conn, game_id: int):
    """특정 1개 경기의 라인스코어(JSON) 및 선수 박스스코어 수집/적재"""
    url = f"https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        live_data = resp.json()
    except Exception as e:
        print(f" -> [Game {game_id}] API 호출 실패: {e}")
        return False

    live_data_game = live_data.get("liveData", {})
    boxscore = live_data_game.get("boxscore", {})
    linescore = live_data_game.get("linescore", {})
    teams_box = boxscore.get("teams", {})

    # 1. 라인스코어(이닝별 점수) 추출 및 games 테이블에 JSON 업데이트
    innings = linescore.get("innings", [])
    # linescore_list = []
    # for inn in innings:
    #     linescore_list.append({
    #         "inning": inn.get("num"),
    #         "away": safe_int(inn.get("away", {}).get("runs", 0)),
    #         "home": safe_int(inn.get("home", {}).get("runs", 0))
    #     })

    # sql_update_linescore = text("""
    #     UPDATE games 
    #     SET linescore = :linescore_json 
    #     WHERE game_id = :gid
    # """)
    # conn.execute(sql_update_linescore, {
    #     "linescore_json": json.dumps(linescore_list),
    #     "gid": game_id
    # 1. 라인스코어 추출
    linescore_list = extract_linescore_data(linescore, game_id)

    # 추출된 라인스코어가 있을 때만 UPDATE
    if linescore_list:
        sql_update_linescore = text("""
            UPDATE games 
            SET linescore = :linescore_json 
            WHERE game_id = :gid
        """)
        conn.execute(sql_update_linescore, {
            "linescore_json": json.dumps(linescore_list),
            "gid": game_id
    })

    # 2. 선수별 박스스코어 적재
    valid_players = set(conn.execute(text("SELECT player_id FROM players")).scalars().all())

    sql_boxscore = text("""
        INSERT INTO game_boxscores (
            game_id, player_id, team_id,
            batting_order, position,
            at_bats, hits, home_runs, rbi, walks, strikeouts,
            innings_pitched, earned_runs, pitch_count,
            runs_allowed, hits_allowed, strikeouts_pitched
        ) VALUES (
            :gid, :pid, :tid,
            :order, :pos,
            :ab, :h, :hr, :rbi, :bb, :so,
            :ip, :er, :pitch_count,
            :r_allowed, :h_allowed, :so_pitched
        )
        ON DUPLICATE KEY UPDATE
            team_id = VALUES(team_id),
            batting_order = VALUES(batting_order),
            position = VALUES(position),
            at_bats = VALUES(at_bats),
            hits = VALUES(hits),
            home_runs = VALUES(home_runs),
            rbi = VALUES(rbi),
            walks = VALUES(walks),
            strikeouts = VALUES(strikeouts),
            innings_pitched = VALUES(innings_pitched),
            earned_runs = VALUES(earned_runs),
            pitch_count = VALUES(pitch_count),
            runs_allowed = VALUES(runs_allowed),
            hits_allowed = VALUES(hits_allowed),
            strikeouts_pitched = VALUES(strikeouts_pitched);
    """)

    for side in ["away", "home"]:
        t_box = teams_box.get(side, {})
        team_id = t_box.get("team", {}).get("id")
        players_data = t_box.get("players", {})

        for p_key, p_val in players_data.items():
            pid = p_val.get("person", {}).get("id")
            if not pid or pid not in valid_players:
                continue

            pos = p_val.get("position", {}).get("abbreviation", "")
            stats = p_val.get("stats", {})
            bat = stats.get("batting", {})
            pitch = stats.get("pitching", {})

            raw_order = p_val.get("battingOrder")
            order_num = None
            if raw_order:
                try:
                    int_order = int(raw_order)
                    order_num = int_order // 100
                except Exception:
                    pass

            has_bat = bool(bat) or (order_num is not None)
            has_pitch = bool(pitch) and (safe_int(pitch.get("pitches", 0)) > 0 or safe_float(pitch.get("inningsPitched", 0.0)) > 0)

            if not (has_bat or has_pitch):
                continue

            conn.execute(sql_boxscore, {
                "gid": game_id,
                "pid": pid,
                "tid": team_id,
                "order": order_num,
                "pos": pos,
                "ab": safe_int(bat.get("atBats", 0)),
                "h": safe_int(bat.get("hits", 0)),
                "hr": safe_int(bat.get("homeRuns", 0)),
                "rbi": safe_int(bat.get("rbi", 0)),
                "bb": safe_int(bat.get("baseOnBalls", 0)),
                "so": safe_int(bat.get("strikeOuts", 0)),
                "ip": safe_float(pitch.get("inningsPitched", 0.0)),
                "er": safe_int(pitch.get("earnedRuns", 0)),
                "pitch_count": safe_int(pitch.get("pitches", 0)),
                "r_allowed": safe_int(pitch.get("runs", 0)),
                "h_allowed": safe_int(pitch.get("hits", 0)),
                "so_pitched": safe_int(pitch.get("strikeOuts", 0))
            })

    return True

def run_boxscore_collector(start_date: str = "2024-04-01", end_date: str = "2024-04-30"):
    """
    원하는 기간(start_date ~ end_date)을 지정하여 경기 상세 및 라인스코어 일괄 수집
    """
    print(f"\n=======================================================")
    print(f"[{start_date} ~ {end_date}] 박스스코어 & 라인스코어 수집 시작")
    print(f"=======================================================")

    with engine.begin() as conn:
        # 지정된 기간 내 종료 경기 조회
        query = text("""
            SELECT g.game_id, g.game_date, ht.team_name as home_team, at.team_name as away_team
            FROM games g
            JOIN teams ht ON g.home_team_id = ht.team_id
            JOIN teams at ON g.away_team_id = at.team_id
            WHERE g.status = 'FINAL'
              AND DATE(g.game_date) BETWEEN :start_date AND :end_date
            ORDER BY g.game_date ASC
        """)
        target_games = conn.execute(query, {
            "start_date": start_date,
            "end_date": end_date
        }).mappings().all()

        if not target_games:
            print(" -> 해당 기간에 수집할 종료 경기(FINAL)가 없습니다.")
            return

        print(f" -> 총 {len(target_games)}개 경기 대상 확인. 순차 수집을 진행합니다.\n")

        success_count = 0
        for idx, g in enumerate(target_games, 1):
            gid = g["game_id"]
            h_name = g["home_team"]
            a_name = g["away_team"]
            date_str = str(g["game_date"])[:10]

            print(f"[{idx}/{len(target_games)}] {date_str} Game {gid}: {a_name} vs {h_name} 적재 중...")
            if collect_boxscore_and_linescore(conn, gid):
                success_count += 1
            time.sleep(0.3)  # MLB API 호출 간격 조절

        print(f"\n>>> 수집 완료: 총 {success_count} / {len(target_games)} 경기 적재 성공!")

def fill_missing_linescores():
    """날짜 상관없이 linescore가 NULL인 종료 경기(FINAL)를 찾아 일괄 적재"""
    print("\n>>> linescore 결측 경기 탐색 및 수집 시작...")
    with engine.begin() as conn:
        query = text("""
            SELECT game_id, game_date, home_score, away_score
            FROM games
            WHERE status = 'FINAL' AND linescore IS NULL
            ORDER BY game_date ASC
        """)
        missing_games = conn.execute(query).mappings().all()

        if not missing_games:
            print(" -> 결측된 경기가 없습니다. 모든 linescore가 정상 적재되어 있습니다.")
            return

        print(f" -> 총 {len(missing_games)}건의 결측 경기 발견. 수집 진행 중...")
        for g in missing_games:
            gid = g["game_id"]
            print(f" -> Game {gid} ({g['game_date']}) 수집 중...")
            collect_boxscore_and_linescore(conn, gid)
            time.sleep(0.3)

        print(">>> 결측치 보완 완료!")

if __name__ == "__main__":
    # 2024년 4월 한 달치 수집 실행 (필요시 날짜 변경 가능)
    run_boxscore_collector(start_date="2024-04-01", end_date="2024-04-30")