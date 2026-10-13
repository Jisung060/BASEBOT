import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import requests
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
}

def repair_games():
    print("==================================================")
    print("1. DB 내 NULL 필드(winning_team_id, stadium, game_time) 보정 시작")
    print("==================================================")

    # 1. 스코어 기반 winning_team_id 즉시 보정 (이미 종료된 경기들)
    with engine.begin() as conn:
        res = conn.execute(text("""
            UPDATE games
            SET winning_team_id = CASE
                WHEN home_score > away_score THEN home_team_id
                WHEN away_score > home_score THEN away_team_id
                ELSE NULL
            END
            WHERE status = 'FINAL' 
              AND winning_team_id IS NULL 
              AND home_score != away_score;
        """))
        print(f" -> 스코어 기반 winning_team_id {res.rowcount}건 즉시 보정 완료")

    # 2. MLB 공식 API를 통해 stadium(경기장) 및 game_time(시간) 보강
    print("\n2. MLB 공식 Schedule API에서 경기장 및 경기 시간 동기화 중...")
    with engine.connect() as conn:
        date_rows = conn.execute(text("SELECT DISTINCT game_date FROM games WHERE game_date IS NOT NULL")).fetchall()
        dates = [str(r[0]) for r in date_rows]

    update_params = []
    for d in dates:
        url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={d}&hydrate=venue"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                dates_data = data.get("dates", [])
                if dates_data:
                    for g in dates_data[0].get("games", []):
                        gid = g.get("gamePk")
                        game_date_iso = g.get("gameDate")  # e.g., 2024-05-01T23:10:00Z
                        venue_name = g.get("venue", {}).get("name")
                        
                        g_time = None
                        if game_date_iso and "T" in game_date_iso:
                            g_time = game_date_iso.split("T")[1].replace("Z", "")[:8]

                        is_final = g.get("status", {}).get("abstractGameState") == "Final"
                        teams = g.get("teams", {})
                        home_winner = teams.get("home", {}).get("isWinner", False)
                        away_winner = teams.get("away", {}).get("isWinner", False)
                        home_id = teams.get("home", {}).get("team", {}).get("id")
                        away_id = teams.get("away", {}).get("team", {}).get("id")

                        winner_id = None
                        if home_winner:
                            winner_id = home_id
                        elif away_winner:
                            winner_id = away_id

                        update_params.append({
                            "gid": gid,
                            "time": g_time,
                            "stadium": venue_name,
                            "winner_id": winner_id
                        })
        except Exception as e:
            print(f"※ {d} 일정 조회 오류: {e}")

    if update_params:
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE games
                SET game_time = COALESCE(:time, game_time),
                    stadium = COALESCE(:stadium, stadium),
                    winning_team_id = COALESCE(:winner_id, winning_team_id)
                WHERE game_id = :gid
            """), update_params)
        print(f" -> MLB 공식 API 기준 총 {len(update_params)}건 경기 상세(경기장/시간/승리팀) 업데이트 완료")

    print("\n>>> 모든 빠진 경기 정보 적재가 성공적으로 완료되었습니다!")

if __name__ == "__main__":
    repair_games()