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
# 1. MLB 공식 API: 기본 타격 성적 수집
# ----------------------------------------------------
def fetch_mlb_batters(season: int = 2024) -> pd.DataFrame:
    print(f"\n[1/4] MLB 공식 API에서 {season} 시즌 타자 기본 성적 수집 중...")
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
        if at_bats < 20:
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
            "strikeouts": int(s.get("strikeOuts", 0)),
        })
        
    df = pd.DataFrame(records)
    print(f" -> MLB 공식 타자 {len(df)}명 확보 완료")
    return df

# ----------------------------------------------------
# 2. FanGraphs: fWAR, wRC+ 수집 (API 직접 조회 + Fallback)
# ----------------------------------------------------
def fetch_fangraphs_batters(season: int = 2024) -> pd.DataFrame:
    print(f"\n[2/4] FanGraphs에서 {season} fWAR 및 wRC+ 수집 중...")
    url = (
        f"https://www.fangraphs.com/api/leaders/major-league/data"
        f"?age=&pos=all&stats=bat&lg=all&qual=20&season={season}&season1={season}"
        f"&startdate=&enddate=&month=0&hand=&team=0&pageitems=2000&pagenum=1"
        f"&ind=0&rost=0&players=0&type=c,wrcplus,war"
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
                        "wrc_plus": int(round(float(row.get("wRC+", 100)))),
                        "fwar": round(float(row.get("WAR", 0.0)), 1)
                    })
            print(f" -> FanGraphs 데이터 {len(records)}명 확보 완료")
            return pd.DataFrame(records)
        else:
            print(f"※ FanGraphs 타자 응답 코드: {resp.status_code} (Fallback 수식 계산 전환)")
    except Exception as e:
        print(f"※ FanGraphs API 수집 예외: {e}")
        
    return pd.DataFrame(columns=['player_id', 'wrc_plus', 'fwar'])

# ----------------------------------------------------
# 3. Baseball Savant: Statcast 기대치(xStats) & 타구질 수집
# ----------------------------------------------------
def fetch_savant_statcast_all(season: int = 2024) -> pd.DataFrame:
    print(f"\n[3/4] Baseball Savant에서 Statcast 기대치(xBA, xSLG, xwOBA) 및 타구질 수집 중...")
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=batter&filter=&sort=4&sortDir=desc&min=15&selections="
        f"player_id,exit_velocity_avg,launch_angle_avg,sweet_spot_percent,barrel_batted_rate,hard_hit_percent,xba,xslg,xwoba&csv=true"
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

        id_col = next((c for c in ['player_id', 'id', 'batter_id', 'batter'] if c in raw_df.columns), raw_df.columns[0])
        raw_df['player_id'] = pd.to_numeric(raw_df[id_col], errors='coerce')
        raw_df = raw_df.dropna(subset=['player_id']).copy()
        raw_df['player_id'] = raw_df['player_id'].astype(int)

        col_mappings = {
            'avg_exit_velocity': ['exit_velocity_avg', 'avg_hit_speed', 'exit_velocity'],
            'launch_angle_avg': ['launch_angle_avg', 'launch_angle', 'angle'],
            'barrel_percentage': ['barrel_batted_rate', 'brl_percent', 'barrel'],
            'hard_hit_percentage': ['hard_hit_percent', 'hardhit_percent', 'hard_hit', 'hardhit'],
            'xba': ['xba', 'est_ba'],
            'xslg': ['xslg', 'est_slg'],
            'xwoba': ['xwoba', 'est_woba'],
            'sweet_spot_percentage': ['sweet_spot_percent', 'sweet_spot']
        }

        result_df = pd.DataFrame({'player_id': raw_df['player_id']})
        for target_col, candidates in col_mappings.items():
            matched = next((actual for actual in raw_df.columns if any(cand in actual for cand in candidates)), None)
            if matched:
                result_df[target_col] = pd.to_numeric(raw_df[matched], errors='coerce')

        result_df = result_df.drop_duplicates(subset=['player_id']).copy()
        print(f" -> Savant Statcast 수집 성공! 총 {len(result_df)}명 확보")
        return result_df

    except Exception as e:
        print(f"※ Savant 타구질 수집 예외: {e}")
        return pd.DataFrame(columns=['player_id', 'avg_exit_velocity', 'launch_angle_avg', 'barrel_percentage', 'hard_hit_percentage', 'xba', 'xslg', 'xwoba', 'sweet_spot_percentage'])

# ----------------------------------------------------
# 4. Baseball Savant: 타자 Plate Discipline (whiff%, chase%)
# ----------------------------------------------------
def fetch_savant_batter_discipline(season: int = 2024) -> pd.DataFrame:
    print(f"\n[4/4] Baseball Savant에서 타자 Whiff% & Chase% 수집 중...")
    url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=batter&filter=&sort=4&sortDir=desc&min=15&selections="
        f"player_id,whiff_percent,oz_swing_percent,chase_percent&csv=true"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        df.columns = [c.lower().strip().replace(" ", "_").replace("%", "").replace("-", "_") for c in df.columns]

        id_col = next((c for c in ['player_id', 'id', 'batter'] if c in df.columns), df.columns[0])
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
        print(f" -> 타자 Whiff/Chase 지표 {len(res)}명 확보 완료")
        return res
    except Exception as e:
        print(f"※ 타자 Whiff/Chase 수집 예외: {e}")
        return pd.DataFrame(columns=['player_id', 'whiff_percentage', 'chase_percentage'])

# ----------------------------------------------------
# 5. 종합 파이프라인 및 DB 적재
# ----------------------------------------------------
def collect_batters_comprehensive(season: int = 2024):
    print("========================================================")
    print(f"[{season} 시즌] 타자 종합 세이버메트릭스 파이프라인 가동")
    print("========================================================")

    mlb_df = fetch_mlb_batters(season)
    if mlb_df.empty:
        print("기본 성적 수집 실패로 종료")
        return

    fg_df = fetch_fangraphs_batters(season)
    savant_df = fetch_savant_statcast_all(season)
    disc_df = fetch_savant_batter_discipline(season)

    print("\n데이터 병합 및 세이버메트릭스 정밀 계산 중...")
    
    # 중복 컬럼 방지 병합
    df = mlb_df.copy()
    for extra_df in [savant_df, disc_df, fg_df]:
        if not extra_df.empty:
            add_cols = ['player_id'] + [c for c in extra_df.columns if c != 'player_id' and c not in df.columns]
            df = pd.merge(df, extra_df[add_cols], on='player_id', how='left')

    if 'fwar' not in df.columns:
        df['fwar'] = np.nan
    if 'wrc_plus' not in df.columns:
        df['wrc_plus'] = np.nan

    df = df.loc[:, ~df.columns.duplicated()].copy()

    # 리그 보정 산출
    league_avg_ops = df['ops'].mean()
    league_avg_obp = df['obp'].mean()
    league_avg_slg = df['slg'].mean()

    for idx, row in df.iterrows():
        df.at[idx, 'bwar'] = round(((row['ops'] - league_avg_ops) * (row['at_bats'] / 95.0)), 1)
        if pd.isna(row.get('wrc_plus')):
            ops_plus = int(round((row['obp'] / league_avg_obp + row['slg'] / league_avg_slg - 1.0) * 100))
            df.at[idx, 'wrc_plus'] = max(30, min(250, ops_plus))
        if pd.isna(row.get('fwar')):
            wrc = df.at[idx, 'wrc_plus']
            pa = row['at_bats'] + row['walks']
            df.at[idx, 'fwar'] = round(((wrc - 100) * (pa / 600.0) * 0.04) + (pa / 600.0 * 1.5), 1)

    # Savant 백분위수 (Percentile: 0 ~ 100)
    percentile_mappings = [
        ('avg_exit_velocity', 'exit_velo_percentile'),
        ('barrel_percentage', 'barrel_percentile'),
        ('hard_hit_percentage', 'hard_hit_percentile'),
        ('xwoba', 'xwoba_percentile')
    ]

    for source_col, target_pct in percentile_mappings:
        if source_col in df.columns:
            series = df[source_col]
            if isinstance(series, pd.DataFrame):
                series = series.iloc[:, 0]
                df[source_col] = series
            
            valid_cnt = int(series.notnull().to_numpy().sum())
            if valid_cnt > 0:
                df[target_pct] = (series.rank(pct=True, ascending=True) * 100).round(0)
            else:
                df[target_pct] = np.nan
        else:
            df[target_pct] = np.nan

    df = df.replace({np.nan: None})

    # DB 적재
    print(f"\n총 {len(df)}명 타자 데이터 DB 적재 시작...")
    with engine.begin() as conn:
        upsert_sql = text("""
            INSERT INTO player_season_stats (
                player_id, season, is_pitcher, games, batting_avg, hits, home_runs, rbi,
                bwar, fwar, wrc_plus,
                avg_exit_velocity, barrel_percentage, hard_hit_percentage,
                xba, xslg, xwoba, launch_angle_avg, sweet_spot_percentage,
                whiff_percentage, chase_percentage,
                exit_velo_percentile, barrel_percentile, hard_hit_percentile, xwoba_percentile
            ) VALUES (
                :player_id, :season, FALSE, :games, :batting_avg, :hits, :home_runs, :rbi,
                :bwar, :fwar, :wrc_plus,
                :avg_exit_velocity, :barrel_percentage, :hard_hit_percentage,
                :xba, :xslg, :xwoba, :launch_angle_avg, :sweet_spot_percentage,
                :whiff_percentage, :chase_percentage,
                :exit_velo_percentile, :barrel_percentile, :hard_hit_percentile, :xwoba_percentile
            )
            ON DUPLICATE KEY UPDATE
                games = VALUES(games),
                batting_avg = VALUES(batting_avg),
                hits = VALUES(hits),
                home_runs = VALUES(home_runs),
                rbi = VALUES(rbi),
                bwar = VALUES(bwar),
                fwar = VALUES(fwar),
                wrc_plus = VALUES(wrc_plus),
                avg_exit_velocity = VALUES(avg_exit_velocity),
                barrel_percentage = VALUES(barrel_percentage),
                hard_hit_percentage = VALUES(hard_hit_percentage),
                xba = VALUES(xba),
                xslg = VALUES(xslg),
                xwoba = VALUES(xwoba),
                launch_angle_avg = VALUES(launch_angle_avg),
                sweet_spot_percentage = VALUES(sweet_spot_percentage),
                whiff_percentage = VALUES(whiff_percentage),
                chase_percentage = VALUES(chase_percentage),
                exit_velo_percentile = VALUES(exit_velo_percentile),
                barrel_percentile = VALUES(barrel_percentile),
                hard_hit_percentile = VALUES(hard_hit_percentile),
                xwoba_percentile = VALUES(xwoba_percentile);
        """)

        for _, row in df.iterrows():
            conn.execute(upsert_sql, {
                'player_id': int(row['player_id']),
                'season': season,
                'games': int(row['games']),
                'batting_avg': float(row['batting_avg']),
                'hits': int(row['hits']),
                'home_runs': int(row['home_runs']),
                'rbi': int(row['rbi']),
                'bwar': float(row['bwar']) if row.get('bwar') is not None else None,
                'fwar': float(row['fwar']) if row.get('fwar') is not None else None,
                'wrc_plus': int(row['wrc_plus']) if row.get('wrc_plus') is not None else None,
                'avg_exit_velocity': float(row['avg_exit_velocity']) if row.get('avg_exit_velocity') is not None else None,
                'barrel_percentage': float(row['barrel_percentage']) if row.get('barrel_percentage') is not None else None,
                'hard_hit_percentage': float(row['hard_hit_percentage']) if row.get('hard_hit_percentage') is not None else None,
                'xba': float(row['xba']) if row.get('xba') is not None else None,
                'xslg': float(row['xslg']) if row.get('xslg') is not None else None,
                'xwoba': float(row['xwoba']) if row.get('xwoba') is not None else None,
                'launch_angle_avg': float(row['launch_angle_avg']) if row.get('launch_angle_avg') is not None else None,
                'sweet_spot_percentage': float(row['sweet_spot_percentage']) if row.get('sweet_spot_percentage') is not None else None,
                'whiff_percentage': float(row['whiff_percentage']) if row.get('whiff_percentage') is not None else None,
                'chase_percentage': float(row['chase_percentage']) if row.get('chase_percentage') is not None else None,
                'exit_velo_percentile': int(row['exit_velo_percentile']) if row.get('exit_velo_percentile') is not None else None,
                'barrel_percentile': int(row['barrel_percentile']) if row.get('barrel_percentile') is not None else None,
                'hard_hit_percentile': int(row['hard_hit_percentile']) if row.get('hard_hit_percentile') is not None else None,
                'xwoba_percentile': int(row['xwoba_percentile']) if row.get('xwoba_percentile') is not None else None,
            })

    print(f"\n>>> [{season} 시즌] 타자 {len(df)}명 종합 세이버메트릭스(Whiff%, Chase% 포함) 적재 완료!")

if __name__ == "__main__":
    collect_batters_comprehensive(season=2024)