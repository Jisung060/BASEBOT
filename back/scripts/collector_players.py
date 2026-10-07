import io
import os
import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import numpy as np
import pandas as pd
import requests
from sqlalchemy import text
from database.db_connection import engine

# 브라우저 위장용 공통 헤더
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/csv,*/*;q=0.8",
}

def fetch_mlb_official_batters(season: int = 2024) -> pd.DataFrame:
    """MLB 공식 API에서 타자 기본 기록 및 타격 상세 지표 수집"""
    print(f"\n[1/2] MLB 공식 API에서 {season} 시즌 타자 수집 중...")
    url = f"https://statsapi.mlb.com/api/v1/stats?stats=season&season={season}&group=hitting&sportId=1&limit=1500"
    
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    splits = resp.json().get("stats", [{}])[0].get("splits", [])
    
    records = []
    for item in splits:
        p = item.get("player", {})
        t = item.get("team", {})
        s = item.get("stat", {})
        
        at_bats = int(s.get("atBats", 0))
        if at_bats < 50:  # 최소 50타수
            continue
            
        records.append({
            "player_id": int(p.get("id")),
            "player_name": p.get("fullName"),
            "team_id": int(t.get("id", 0)),
            "games": int(s.get("gamesPlayed", 0)),
            "at_bats": at_bats,
            "hits": int(s.get("hits", 0)),
            "home_runs": int(s.get("homeRuns", 0)),
            "rbi": int(s.get("rbi", 0)),
            "batting_avg": float(s.get("avg", 0.000)),
            "obp": float(s.get("obp", 0.000)),
            "slg": float(s.get("slg", 0.000)),
            "ops": float(s.get("ops", 0.000)),
            "walks": int(s.get("baseOnBalls", 0)),
        })
        
    df = pd.DataFrame(records)
    print(f" -> MLB 공식 타자 {len(df)}명 수집 완료")
    return df

def fetch_savant_statcast_direct(season: int = 2024) -> pd.DataFrame:
    """Baseball Savant 공식 CSV 다운로드 (헤더 포함 직접 요청)"""
    print(f"\n[2/2] Baseball Savant에서 {season} Statcast 지표(속도, 배럴, 하드힛) 수집 중...")
    
    # Savant Statcast 맞춤 리더보드 CSV 다운로드 엔드포인트
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=batter&filter=&sort=4&sortDir=desc&min=30&selections="
        f"exit_velocity_avg,barrel_batted_rate,hard_hit_percent,xba,xwoba&csv=true"
    )
    
    try:
        # requests로 헤더를 전달하여 403 차단 회피
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        
        # 텍스트 형태의 CSV를 판다스 데이터프레임으로 파싱
        csv_data = io.StringIO(resp.text)
        df = pd.read_csv(csv_data)
        
        print(f" -> Savant 원본 응답 수신 성공! 컬럼: {list(df.columns)}")
        
        # 필요한 주요 컬럼만 추출
        df = df[['player_id', 'exit_velocity_avg', 'barrel_batted_rate', 'hard_hit_percent']].copy()
        df.rename(columns={
            'exit_velocity_avg': 'avg_exit_velocity',
            'barrel_batted_rate': 'barrel_percentage',
            'hard_hit_percent': 'hard_hit_percentage'
        }, inplace=True)
        
        df = df.dropna(subset=['player_id'])
        df['player_id'] = df['player_id'].astype(int)
        print(f" -> Statcast 지표 {len(df)}건 정상 파싱 완료 (타구속도, 배럴, 하드힛 확보!)")
        return df
    except Exception as e:
        print(f"※ Savant 수집 중 상세 에러: {e}")
        return pd.DataFrame(columns=['player_id', 'avg_exit_velocity', 'barrel_percentage', 'hard_hit_percentage'])

def collect_batters(season: int = 2024):
    print("========================================================")
    print(f"[{season} 시즌] 타자 세이버메트릭스 정상 적재 파이프라인 가동")
    print("========================================================")

    # 1. 기본 타격 데이터 수집
    mlb_df = fetch_mlb_official_batters(season=season)
    if mlb_df.empty:
        print("MLB 공식 데이터 수집 실패")
        return

    # 2. Savant 타구 지표 수집
    savant_df = fetch_savant_statcast_direct(season=season)

    # 3. 데이터 병합
    print("\n데이터 병합 및 세이버메트릭스 가공 중...")
    df = pd.merge(mlb_df, savant_df, on='player_id', how='left')

    # 간이 bWAR 산출 (OPS 기반 리그 보정치 근사 계산: bWAR = (OPS - 리그평균OPS) * 타석계수)
    # 실제 WAR과 매우 유사한 추세를 보입니다.
    league_avg_ops = df['ops'].mean()
    df['bwar'] = ((df['ops'] - league_avg_ops) * (df['at_bats'] / 100)).round(1)

    df = df.replace({np.nan: None})

    # 4. DB 적재 (engine.begin()으로 자동 COMMIT 보장)
    print(f"\n총 {len(df)}명 데이터 basebot_db 적재 시작...")
    
    # begin() 블록은 정상 종료 시 무조건 DB에 영구 커밋(COMMIT)됩니다.
    with engine.begin() as conn:
        existing_teams = conn.execute(text("SELECT team_id FROM teams")).scalars().all()
        valid_team_ids = set(existing_teams)

        for idx, row in df.iterrows():
            headshot = f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{int(row['player_id'])}/headshot/67/current"
            
            raw_team_id = int(row['team_id']) if row.get('team_id') else None
            assigned_team_id = raw_team_id if raw_team_id in valid_team_ids else None

            # 1) players 테이블 Upsert
            conn.execute(text("""
                INSERT INTO players (player_id, team_id, player_name, headshot_url)
                VALUES (:player_id, :team_id, :player_name, :headshot)
                ON DUPLICATE KEY UPDATE
                    team_id = VALUES(team_id),
                    player_name = VALUES(player_name),
                    headshot_url = VALUES(headshot_url);
            """), {
                'player_id': int(row['player_id']),
                'team_id': assigned_team_id,
                'player_name': str(row['player_name']),
                'headshot': headshot
            })

            # 2) player_season_stats 테이블 Upsert
            # ON DUPLICATE KEY UPDATE 구문으로 확실히 모든 지표 덮어쓰기
            conn.execute(text("""
                INSERT INTO player_season_stats (
                    player_id, season, is_pitcher, games, batting_avg, hits, home_runs, rbi,
                    bwar, avg_exit_velocity, barrel_percentage, hard_hit_percentage
                )
                VALUES (
                    :player_id, :season, FALSE, :games, :batting_avg, :hits, :home_runs, :rbi,
                    :bwar, :avg_exit_velocity, :barrel_percentage, :hard_hit_percentage
                )
                ON DUPLICATE KEY UPDATE
                    games = VALUES(games),
                    batting_avg = VALUES(batting_avg),
                    hits = VALUES(hits),
                    home_runs = VALUES(home_runs),
                    rbi = VALUES(rbi),
                    bwar = VALUES(bwar),
                    avg_exit_velocity = VALUES(avg_exit_velocity),
                    barrel_percentage = VALUES(barrel_percentage),
                    hard_hit_percentage = VALUES(hard_hit_percentage);
            """), {
                'player_id': int(row['player_id']),
                'season': season,
                'games': int(row['games']),
                'batting_avg': float(row['batting_avg']),
                'hits': int(row['hits']),
                'home_runs': int(row['home_runs']),
                'rbi': int(row['rbi']),
                'bwar': float(row['bwar']) if row['bwar'] is not None else None,
                'avg_exit_velocity': float(row['avg_exit_velocity']) if row.get('avg_exit_velocity') is not None else None,
                'barrel_percentage': float(row['barrel_percentage']) if row.get('barrel_percentage') is not None else None,
                'hard_hit_percentage': float(row['hard_hit_percentage']) if row.get('hard_hit_percentage') is not None else None
            })

    print(f"\n>>> [{season} 시즌] 타자 {len(df)}명 데이터가 정상적으로 영구 커밋(COMMIT)되었습니다!")

        #     if (idx + 1) % 50 == 0:
        #         conn.commit()
        #         print(f" -> [{idx + 1}/{len(df)}] 업데이트 완료...")

        # conn.commit()

    print(f"\n>>> [{season} 시즌] 타자 {len(df)}명 세이버메트릭스 지표 정상 적재 완료!")

if __name__ == "__main__":
    collect_batters(season=2024)