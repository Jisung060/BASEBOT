import io
import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import pandas as pd
import requests
from sqlalchemy import text
from database.db_connection import engine

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/csv,*/*;q=0.8",
}

def fetch_discipline(season: int, p_type: str) -> pd.DataFrame:
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type={p_type}&filter=&sort=4&sortDir=desc&min=15&selections="
        f"player_id,whiff_percent,oz_swing_percent,chase_percent&csv=true"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        df.columns = [c.lower().strip().replace(" ", "_").replace("%", "").replace("-", "_") for c in df.columns]
        
        id_col = 'player_id' if 'player_id' in df.columns else df.columns[0]
        df['player_id'] = pd.to_numeric(df[id_col], errors='coerce')
        df = df.dropna(subset=['player_id']).copy()
        df['player_id'] = df['player_id'].astype(int)
        
        whiff_col = next((c for c in df.columns if 'whiff' in c), None)
        chase_col = next((c for c in df.columns if 'oz_swing' in c or 'chase' in c), None)
        
        res = pd.DataFrame({'player_id': df['player_id']})
        res['whiff_percentage'] = pd.to_numeric(df[whiff_col], errors='coerce') if whiff_col else None
        res['chase_percentage'] = pd.to_numeric(df[chase_col], errors='coerce') if chase_col else None
        return res.drop_duplicates(subset=['player_id'])
    except Exception as e:
        print(f"[{p_type}] 수집 예외: {e}")
        return pd.DataFrame()

def run_patch(season: int = 2024):
    print("========================================================")
    print(f"[{season} 시즌] Whiff% 및 Chase% 결측치 일괄 패치")
    print("========================================================")
    
    # 1. 타자 지표 수집 및 갱신
    bat_df = fetch_discipline(season, "batter")
    # 2. 투수 지표 수집 및 갱신
    pit_df = fetch_discipline(season, "pitcher")
    
    with engine.begin() as conn:
        update_sql = text("""
            UPDATE player_season_stats
            SET whiff_percentage = :whiff,
                chase_percentage = :chase
            WHERE player_id = :pid AND season = :season AND is_pitcher = :is_pitcher
        """)
        
        # 타자 반영
        b_count = 0
        for _, row in bat_df.iterrows():
            res = conn.execute(update_sql, {
                'whiff': float(row['whiff_percentage']) if pd.notnull(row['whiff_percentage']) else None,
                'chase': float(row['chase_percentage']) if pd.notnull(row['chase_percentage']) else None,
                'pid': int(row['player_id']),
                'season': season,
                'is_pitcher': False
            })
            b_count += res.rowcount
            
        # 투수 반영
        p_count = 0
        for _, row in pit_df.iterrows():
            res = conn.execute(update_sql, {
                'whiff': float(row['whiff_percentage']) if pd.notnull(row['whiff_percentage']) else None,
                'chase': float(row['chase_percentage']) if pd.notnull(row['chase_percentage']) else None,
                'pid': int(row['player_id']),
                'season': season,
                'is_pitcher': True
            })
            p_count += res.rowcount

    print(f"\n>>> 완료! 타자 {b_count}명, 투수 {p_count}명의 whiff% / chase%가 DB에 성공적으로 채워졌습니다.")

if __name__ == "__main__":
    run_patch(season=2024)