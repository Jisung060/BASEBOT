import io
import os
import sys
import time
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import numpy as np
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

# ----------------------------------------------------
# 1. MLB 공식 API: 투수 기본 성적 수집
# ----------------------------------------------------
def fetch_mlb_pitchers(season: int = 2024) -> pd.DataFrame:
    print(f"\n[1/4] MLB 공식 API에서 {season} 시즌 투수 기본 성적 수집 중...")
    url = f"https://statsapi.mlb.com/api/v1/stats?stats=season&season={season}&group=pitching&sportId=1&limit=1500"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    splits = resp.json().get("stats", [{}])[0].get("splits", [])
    
    records = []
    for item in splits:
        p = item.get("player", {})
        t = item.get("team", {})
        s = item.get("stat", {})
        
        innings = float(s.get("inningsPitched", 0.0))
        if innings < 10.0:
            continue
            
        records.append({
            "player_id": int(p.get("id")),
            "player_name": p.get("fullName"),
            "team_id": int(t.get("id", 0)),
            "games": int(s.get("gamesPlayed", 0)),
            "wins": int(s.get("wins", 0)),
            "losses": int(s.get("losses", 0)),
            "era": float(s.get("era", 0.00)),
            "innings_pitched": innings,
            "strikeouts": int(s.get("strikeOuts", 0)),
            "walks": int(s.get("baseOnBalls", 0)),
            "hit_by_pitch": int(s.get("hitByPitch", 0)),
            "home_runs_allowed": int(s.get("homeRuns", 0)),
            "whip": float(s.get("whip", 0.00))
        })
        
    df = pd.DataFrame(records)
    print(f" -> MLB 공식 투수 {len(df)}명 확보 완료")
    return df

# ----------------------------------------------------
# 2. FanGraphs: 투수 fWAR 및 FIP 수집
# ----------------------------------------------------
def fetch_fangraphs_pitchers(season: int = 2024) -> pd.DataFrame:
    print(f"\n[2/4] FanGraphs에서 {season} 투수 fWAR 및 FIP 수집 중...")
    url = (
        f"https://www.fangraphs.com/api/leaders/major-league/data"
        f"?age=&pos=all&stats=pit&lg=all&qual=10&season={season}&season1={season}"
        f"&startdate=&enddate=&month=0&hand=&team=0&pageitems=2000&pagenum=1"
        f"&ind=0&rost=0&players=0&type=c,fip,war"
    )
    records = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            for row in resp.json().get("data", []):
                mlb_id = row.get("xMLBAMID")
                if mlb_id and str(mlb_id).isdigit():
                    records.append({
                        "player_id": int(mlb_id),
                        "fip": round(float(row.get("FIP", 0.0)), 2),
                        "fwar": round(float(row.get("WAR", 0.0)), 1)
                    })
            print(f" -> FanGraphs 투수 데이터 {len(records)}명 확보 완료")
            return pd.DataFrame(records)
        else:
            print(f"※ FanGraphs 투수 응답 코드: {resp.status_code} (Fallback 수식 계산 전환)")
    except Exception as e:
        print(f"※ FanGraphs 투수 API 수집 건너뜀 ({e})")
        
    return pd.DataFrame(columns=['player_id', 'fip', 'fwar'])

# ----------------------------------------------------
# 3. Baseball Savant: 투수 Statcast 기대치(xERA) 및 피타구질
# ----------------------------------------------------
def fetch_savant_pitcher_statcast(season: int = 2024) -> pd.DataFrame:
    print(f"\n[3/4] Baseball Savant에서 투수 Statcast 지표(xERA, 피타구속도, 피배럴%) 수집 중...")
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=pitcher&filter=&sort=4&sortDir=asc&min=15&selections="
        f"player_id,exit_velocity_avg,launch_angle_avg,barrel_batted_rate,hard_hit_percent,xera&csv=true"
    )

    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        raw_df = pd.read_csv(io.StringIO(resp.text))

        clean_cols = {}
        for col in raw_df.columns:
            clean = col.lower().strip().replace(" ", "_").replace("%", "").replace("-", "_")
            clean_cols[col] = clean
        raw_df.rename(columns=clean_cols, inplace=True)

        id_col = next((c for c in ['player_id', 'id', 'pitcher_id', 'pitcher'] if c in raw_df.columns), raw_df.columns[0])
        raw_df['player_id'] = pd.to_numeric(raw_df[id_col], errors='coerce')
        raw_df = raw_df.dropna(subset=['player_id']).copy()
        raw_df['player_id'] = raw_df['player_id'].astype(int)

        col_mappings = {
            'avg_exit_velocity': ['exit_velocity_avg', 'avg_hit_speed', 'exit_velocity'],
            'barrel_percentage': ['barrel_batted_rate', 'brl_percent', 'barrel'],
            'hard_hit_percentage': ['hard_hit_percent', 'hardhit_percent', 'hard_hit'],
            'xera': ['xera', 'est_era']
        }

        result_df = pd.DataFrame({'player_id': raw_df['player_id']})
        for target_col, candidates in col_mappings.items():
            matched = next((actual for actual in raw_df.columns if any(cand in actual for cand in candidates)), None)
            if matched:
                result_df[target_col] = pd.to_numeric(raw_df[matched], errors='coerce')

        result_df = result_df.drop_duplicates(subset=['player_id']).copy()
        print(f" -> Savant 투수 데이터 수집 성공! 총 {len(result_df)}명 확보")
        return result_df

    except Exception as e:
        print(f"※ Savant 투수 수집 건너뜀: {e}")
        return pd.DataFrame(columns=['player_id', 'avg_exit_velocity', 'barrel_percentage', 'hard_hit_percentage', 'xera'])

# ----------------------------------------------------
# 4. Baseball Savant: 투수 Plate Discipline (whiff%, chase% 유도율)
# ----------------------------------------------------
def fetch_savant_pitcher_discipline(season: int = 2024) -> pd.DataFrame:
    print(f"\n[4/4] Baseball Savant에서 투수 Whiff% & Chase% 유도율 수집 중...")
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=pitcher&filter=&sort=4&sortDir=desc&min=15&selections="
        f"player_id,whiff_percent,oz_swing_percent,chase_percent&csv=true"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        df.columns = [c.lower().strip().replace(" ", "_").replace("%", "").replace("-", "_") for c in df.columns]

        id_col = next((c for c in ['player_id', 'id', 'pitcher'] if c in df.columns), df.columns[0])
        df['player_id'] = pd.to_numeric(df[id_col], errors='coerce')
        df = df.dropna(subset=['player_id']).copy()
        df['player_id'] = df['player_id'].astype(int)

        whiff_col = next((c for c in df.columns if 'whiff' in c), None)
        chase_col = next((c for c in df.columns if 'oz_swing' in c or 'chase' in c), None)

        res = pd.DataFrame({'player_id': df['player_id']})
        if whiff_col:
            res['whiff_percentage'] = pd.to_numeric(df[whiff_col], errors='coerce')
        if chase_col:
            res['chase_percentage'] = pd.to_numeric(df[chase_col], errors='coerce')

        res = res.drop_duplicates(subset=['player_id']).copy()
        print(f" -> 투수 Whiff/Chase 지표 {len(res)}명 확보 완료")
        return res
    except Exception as e:
        print(f"※ 투수 Whiff/Chase 수집 예외: {e}")
        return pd.DataFrame(columns=['player_id', 'whiff_percentage', 'chase_percentage'])

# ----------------------------------------------------
# 5. 종합 파이프라인 및 DB 적재
# ----------------------------------------------------
def collect_pitchers_comprehensive(season: int = 2024):
    print("========================================================")
    print(f"[{season} 시즌] 투수 종합 세이버메트릭스 파이프라인 가동")
    print("========================================================")

    mlb_df = fetch_mlb_pitchers(season)
    if mlb_df.empty:
        print("기본 성적 수집 실패")
        return

    fg_df = fetch_fangraphs_pitchers(season)
    savant_df = fetch_savant_pitcher_statcast(season)
    disc_df = fetch_savant_pitcher_discipline(season)

    print("\n데이터 병합 및 투수 세이버메트릭스(FIP, WAR) 정밀 계산 중...")
    
    df = mlb_df.copy()
    for extra_df in [savant_df, disc_df, fg_df]:
        if not extra_df.empty:
            add_cols = ['player_id'] + [c for c in extra_df.columns if c != 'player_id' and c not in df.columns]
            df = pd.merge(df, extra_df[add_cols], on='player_id', how='left')

    if 'fip' not in df.columns:
        df['fip'] = np.nan
    if 'fwar' not in df.columns:
        df['fwar'] = np.nan

    df = df.loc[:, ~df.columns.duplicated()].copy()

    # 리그 상수 및 FIP 산출
    league_fip_constant = 3.10
    league_avg_era = 4.15

    for idx, row in df.iterrows():
        ip = max(row['innings_pitched'], 1.0)
        if pd.isna(row.get('fip')):
            hr = row['home_runs_allowed']
            bb = row['walks']
            hbp = row['hit_by_pitch']
            k = row['strikeouts']
            calc_fip = round(((13 * hr + 3 * (bb + hbp) - 2 * k) / ip) + league_fip_constant, 2)
            df.at[idx, 'fip'] = calc_fip

        era = row['era']
        bwar_val = round(((league_avg_era - era) / 9.0 * ip / 10.0) + (ip / 200.0), 1)
        df.at[idx, 'bwar'] = max(-2.0, min(12.0, bwar_val))

        if pd.isna(row.get('fwar')):
            fip = df.at[idx, 'fip']
            fwar_val = round(((league_avg_era - fip) / 9.0 * ip / 10.0) + (ip / 200.0), 1)
            df.at[idx, 'fwar'] = max(-2.0, min(12.0, fwar_val))

    # 투수 백분위수 (낮을수록 우수하므로 피안타/타구질은 ascending=False)
    percentile_mappings = [
        ('avg_exit_velocity', 'exit_velo_percentile', False),
        ('barrel_percentage', 'barrel_percentile', False),
        ('hard_hit_percentage', 'hard_hit_percentile', False),
        ('xera', 'xwoba_percentile', False)
    ]

    for source_col, target_pct, is_asc in percentile_mappings:
        if source_col in df.columns:
            series = df[source_col]
            if isinstance(series, pd.DataFrame):
                series = series.iloc[:, 0]
                df[source_col] = series
            
            valid_cnt = int(series.notnull().to_numpy().sum())
            if valid_cnt > 0:
                df[target_pct] = (series.rank(pct=True, ascending=is_asc) * 100).round(0)
            else:
                df[target_pct] = np.nan
        else:
            df[target_pct] = np.nan

    df = df.replace({np.nan: None})

    print(f"\n총 {len(df)}명 투수 데이터 DB 적재 시작...")
    with engine.begin() as conn:
        existing_teams = conn.execute(text("SELECT team_id FROM teams")).scalars().all()
        valid_team_ids = set(existing_teams)

        upsert_player_sql = text("""
            INSERT INTO players (player_id, team_id, player_name, headshot_url)
            VALUES (:player_id, :team_id, :player_name, :headshot)
            ON DUPLICATE KEY UPDATE
                team_id = COALESCE(VALUES(team_id), team_id),
                player_name = VALUES(player_name),
                headshot_url = VALUES(headshot_url);
        """)

        upsert_stats_sql = text("""
            INSERT INTO player_season_stats (
                player_id, season, is_pitcher, games,
                wins, losses, era, innings_pitched, strikeouts, walks, whip,
                bwar, fwar, fip, xera,
                avg_exit_velocity, barrel_percentage, hard_hit_percentage,
                whiff_percentage, chase_percentage,
                exit_velo_percentile, barrel_percentile, hard_hit_percentile, xwoba_percentile
            ) VALUES (
                :player_id, :season, TRUE, :games,
                :wins, :losses, :era, :innings_pitched, :strikeouts, :walks, :whip,
                :bwar, :fwar, :fip, :xera,
                :avg_exit_velocity, :barrel_percentage, :hard_hit_percentage,
                :whiff_percentage, :chase_percentage,
                :exit_velo_percentile, :barrel_percentile, :hard_hit_percentile, :xwoba_percentile
            )
            ON DUPLICATE KEY UPDATE
                is_pitcher = TRUE,
                games = VALUES(games),
                wins = VALUES(wins),
                losses = VALUES(losses),
                era = VALUES(era),
                innings_pitched = VALUES(innings_pitched),
                strikeouts = VALUES(strikeouts),
                walks = VALUES(walks),
                whip = VALUES(whip),
                bwar = VALUES(bwar),
                fwar = VALUES(fwar),
                fip = VALUES(fip),
                xera = VALUES(xera),
                avg_exit_velocity = VALUES(avg_exit_velocity),
                barrel_percentage = VALUES(barrel_percentage),
                hard_hit_percentage = VALUES(hard_hit_percentage),
                whiff_percentage = VALUES(whiff_percentage),
                chase_percentage = VALUES(chase_percentage),
                exit_velo_percentile = VALUES(exit_velo_percentile),
                barrel_percentile = VALUES(barrel_percentile),
                hard_hit_percentile = VALUES(hard_hit_percentile),
                xwoba_percentile = VALUES(xwoba_percentile);
        """)

        for _, row in df.iterrows():
            pid = int(row['player_id'])
            raw_team_id = int(row['team_id']) if row.get('team_id') else None
            assigned_team = raw_team_id if raw_team_id in valid_team_ids else None
            headshot = f"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/{pid}/headshot/67/current"

            conn.execute(upsert_player_sql, {
                'player_id': pid,
                'team_id': assigned_team,
                'player_name': str(row['player_name']),
                'headshot': headshot
            })

            conn.execute(upsert_stats_sql, {
                'player_id': pid,
                'season': season,
                'games': int(row['games']),
                'wins': int(row['wins']),
                'losses': int(row['losses']),
                'era': float(row['era']),
                'innings_pitched': float(row['innings_pitched']),
                'strikeouts': int(row['strikeouts']),
                'walks': int(row['walks']),
                'whip': float(row['whip']),
                'bwar': float(row['bwar']) if row.get('bwar') is not None else None,
                'fwar': float(row['fwar']) if row.get('fwar') is not None else None,
                'fip': float(row['fip']) if row.get('fip') is not None else None,
                'xera': float(row['xera']) if row.get('xera') is not None else None,
                'avg_exit_velocity': float(row['avg_exit_velocity']) if row.get('avg_exit_velocity') is not None else None,
                'barrel_percentage': float(row['barrel_percentage']) if row.get('barrel_percentage') is not None else None,
                'hard_hit_percentage': float(row['hard_hit_percentage']) if row.get('hard_hit_percentage') is not None else None,
                'whiff_percentage': float(row['whiff_percentage']) if row.get('whiff_percentage') is not None else None,
                'chase_percentage': float(row['chase_percentage']) if row.get('chase_percentage') is not None else None,
                'exit_velo_percentile': int(row['exit_velo_percentile']) if row.get('exit_velo_percentile') is not None else None,
                'barrel_percentile': int(row['barrel_percentile']) if row.get('barrel_percentile') is not None else None,
                'hard_hit_percentile': int(row['hard_hit_percentile']) if row.get('hard_hit_percentile') is not None else None,
                'xwoba_percentile': int(row['xwoba_percentile']) if row.get('xwoba_percentile') is not None else None,
            })

    print(f"\n>>> [{season} 시즌] 투수 {len(df)}명 데이터(Whiff%, Chase% 포함) 영구 적재 완료!")

if __name__ == "__main__":
    collect_pitchers_comprehensive(season=2024)