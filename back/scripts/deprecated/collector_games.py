import os
import sys
from pathlib import Path
from datetime import datetime

# 모듈 검색 경로에 back 폴더 추가
BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import requests
import pandas as pd
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def map_mlb_status_to_enum(detailed_state: str) -> str:
    """
    MLB 공식 API의 detailedState 문자열을 DB ENUM 규격으로 변환:
    ENUM('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'CANCELLED')
    """
    if not detailed_state:
        return "SCHEDULED"

    state_lower = str(detailed_state).strip().lower()

    if any(k in state_lower for k in ["final", "completed", "game over"]):
        return "FINAL"
    elif any(k in state_lower for k in ["progress", "live", "warmup", "replay", "review"]):
        return "IN_PROGRESS"
    elif any(k in state_lower for k in ["cancelled", "canceled", "postponed", "suspended"]):
        return "CANCELLED"
    else:
        return "SCHEDULED"

def fetch_mlb_games(season: int = 2024, start_date: str = "2024-04-01", end_date: str = "2024-04-30"):
    """
    MLB 공식 Stats API에서 지정한 기간의 정규시즌 경기 일정 및 결과 수집
    """
    print(f"\n[{season} 시즌] {start_date} ~ {end_date} 경기 일정 수집 시작...")
    url = (
        f"https://statsapi.mlb.com/api/v1/schedule"
        f"?sportId=1&season={season}&startDate={start_date}&endDate={end_date}&gameType=R"
    )

    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    dates = resp.json().get("dates", [])

    games = []
    for d in dates:
        for g in d.get("games", []):
            game_id = g.get("gamePk")
            game_date = g.get("gameDate")
            detailed_state = g.get("status", {}).get("detailedState", "")

            teams = g.get("teams", {})
            away = teams.get("away", {})
            home = teams.get("home", {})

            away_id = away.get("team", {}).get("id")
            home_id = home.get("team", {}).get("id")

            away_score = away.get("score")
            home_score = home.get("score")

            enum_status = map_mlb_status_to_enum(detailed_state)

            games.append({
                "game_id": game_id,
                "game_date": game_date,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "home_score": home_score,
                "away_score": away_score,
                "status": enum_status
            })

    df = pd.DataFrame(games)
    print(f" -> 총 {len(df)}개 경기 데이터 파싱 완료")
    return df

def load_games_to_db(df: pd.DataFrame):
    """basebot_db games 테이블에 적재"""
    if df.empty:
        print("적재할 경기 데이터가 없습니다.")
        return

    print("DB 적재를 시작합니다...")
    with engine.begin() as conn:
        valid_teams = set(conn.execute(text("SELECT team_id FROM teams")).scalars().all())

        sql = text("""
            INSERT INTO games (game_id, game_date, home_team_id, away_team_id, home_score, away_score, status)
            VALUES (:game_id, :game_date, :home_team_id, :away_team_id, :home_score, :away_score, :status)
            ON DUPLICATE KEY UPDATE
                game_date = VALUES(game_date),
                home_team_id = VALUES(home_team_id),
                away_team_id = VALUES(away_team_id),
                home_score = VALUES(home_score),
                away_score = VALUES(away_score),
                status = VALUES(status);
        """)

        inserted_count = 0
        for _, row in df.iterrows():
            if row["home_team_id"] not in valid_teams or row["away_team_id"] not in valid_teams:
                continue

            dt_raw = row["game_date"].replace("Z", "+00:00")
            parsed_dt = datetime.fromisoformat(dt_raw).strftime("%Y-%m-%d %H:%M:%S")

            # ★ NOT NULL 제약조건 방어: 점수가 None이면 0으로 치환
            h_score = int(row["home_score"]) if pd.notnull(row["home_score"]) else 0
            a_score = int(row["away_score"]) if pd.notnull(row["away_score"]) else 0

            conn.execute(sql, {
                "game_id": int(row["game_id"]),
                "game_date": parsed_dt,
                "home_team_id": int(row["home_team_id"]),
                "away_team_id": int(row["away_team_id"]),
                "home_score": h_score,
                "away_score": a_score,
                "status": row["status"]
            })
            inserted_count += 1

    print(f">>> games 테이블에 총 {inserted_count}건 적재 완료!")

if __name__ == "__main__":
    df_games = fetch_mlb_games(season=2024, start_date="2024-04-01", end_date="2024-04-30")
    load_games_to_db(df_games)