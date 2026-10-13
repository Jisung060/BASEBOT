import io
import math
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

# 브라우저 세션 모방
session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
})

# 세션 초기화 (쿠키 발급)
try:
    session.get("https://baseballsavant.mlb.com", timeout=15)
except Exception:
    pass


def clean_val(val, to_int=False):
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return int(round(f)) if to_int else f
    except (ValueError, TypeError):
        return None


# ----------------------------------------------------
# 1. Sprint Speed 수집 (주루)
# ----------------------------------------------------
def fetch_sprint_speed(season: int = 2024) -> pd.DataFrame:
    print(f"\n[1/6] [{season}] Savant Sprint Speed 수집 중...")
    url = f"https://baseballsavant.mlb.com/leaderboard/sprint_speed?year={season}&position=&team=&min=5&csv=true"
    try:
        resp = session.get(url, timeout=25)
        if "player_id" in resp.text.lower() or "speed" in resp.text.lower():
            df = pd.read_csv(io.StringIO(resp.text))
            df.columns = [c.lower().strip() for c in df.columns]
            id_col = next((c for c in df.columns if 'id' in c), df.columns[0])
            spd_col = next((c for c in df.columns if 'sprint_speed' in c or 'speed' in c), None)

            if spd_col:
                df['player_id'] = pd.to_numeric(df[id_col], errors='coerce')
                df['sprint_speed'] = pd.to_numeric(df[spd_col], errors='coerce')
                df = df.dropna(subset=['player_id', 'sprint_speed'])
                df['player_id'] = df['player_id'].astype(int)
                df['sprint_speed_percentile'] = (df['sprint_speed'].rank(pct=True) * 100).round(0).astype(int)
                res = df[['player_id', 'sprint_speed', 'sprint_speed_percentile']].drop_duplicates(subset=['player_id'])
                print(f" -> Sprint Speed {len(res)}명 확보 완료")
                return res
        print(f"※ 응답 본문 상태: {resp.status_code}, 크기: {len(resp.text)}")
    except Exception as e:
        print(f"※ Sprint Speed 수집 실패: {e}")
    return pd.DataFrame()


# ----------------------------------------------------
# 2. OAA (수비) 수집 (공식 CSV 규격)
# ----------------------------------------------------
def fetch_fielding_oaa(season: int = 2024) -> pd.DataFrame:
    print(f"\n[2/6] [{season}] Savant Outs Above Average (OAA) 수집 중...")
    url = f"https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=player&year={season}&min=1&roles=&viz=show&csv=true"
    try:
        resp = session.get(url, timeout=25)
        if len(resp.text) > 200:
            df = pd.read_csv(io.StringIO(resp.text))
            df.columns = [c.lower().strip().replace('"', '') for c in df.columns]

            id_col = next((c for c in ['entity_id', 'player_id'] if c in df.columns), df.columns[0])
            oaa_col = next((c for c in ['outs_above_average', 'fielding_runs_prevented', 'oaa'] if c in df.columns),
                           None)

            if oaa_col:
                df['player_id'] = pd.to_numeric(df[id_col], errors='coerce')
                df['outs_above_average'] = pd.to_numeric(df[oaa_col], errors='coerce')
                df = df.dropna(subset=['player_id', 'outs_above_average'])
                df['player_id'] = df['player_id'].astype(int)
                df['outs_above_average'] = df['outs_above_average'].round(0).astype(int)
                df['oaa_percentile'] = (df['outs_above_average'].rank(pct=True) * 100).round(0).astype(int)
                res = df[['player_id', 'outs_above_average', 'oaa_percentile']].drop_duplicates(subset=['player_id'])
                print(f" -> OAA {len(res)}명 확보 완료 (컬럼: {oaa_col})")
                return res
        print(f"※ OAA 응답 이상 (크기: {len(resp.text)})")
    except Exception as e:
        print(f"※ OAA 수집 실패: {e}")
    return pd.DataFrame()


# ----------------------------------------------------
# 3. Arm Strength (송구)
# ----------------------------------------------------
def fetch_arm_strength(season: int = 2024) -> pd.DataFrame:
    print(f"\n[3/6] [{season}] Savant Arm Strength 수집 중...")
    url = f"https://baseballsavant.mlb.com/leaderboard/arm-strength?year={season}&min=5&csv=true"
    try:
        resp = session.get(url, timeout=25)
        if "arm" in resp.text.lower():
            df = pd.read_csv(io.StringIO(resp.text))
            df.columns = [c.lower().strip() for c in df.columns]
            id_col = next((c for c in df.columns if 'id' in c), df.columns[0])
            arm_col = next((c for c in df.columns if 'arm_strength' in c or 'arm' in c), None)

            if arm_col:
                df['player_id'] = pd.to_numeric(df[id_col], errors='coerce')
                df['arm_strength'] = pd.to_numeric(df[arm_col], errors='coerce')
                df = df.dropna(subset=['player_id', 'arm_strength'])
                df['player_id'] = df['player_id'].astype(int)
                df['arm_strength_percentile'] = (df['arm_strength'].rank(pct=True) * 100).round(0).astype(int)
                res = df[['player_id', 'arm_strength', 'arm_strength_percentile']].drop_duplicates(subset=['player_id'])
                print(f" -> Arm Strength {len(res)}명 확보 완료")
                return res
    except Exception as e:
        print(f"※ Arm Strength 수집 실패: {e}")
    return pd.DataFrame()


# ----------------------------------------------------
# 4. Run Value 수집 (Custom Leaderboard 안전 쿼리)
# ----------------------------------------------------
def fetch_run_values(season: int = 2024) -> tuple[pd.DataFrame, pd.DataFrame]:
    print(f"\n[4/6] [{season}] Savant Run Value 수집 중...")

    # 4-1. 타자 런밸류
    bat_url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=batter&filter=&sort=4&sortDir=desc&min=10&selections="
        f"player_id,batting_run_value,baserunning_run_value&csv=true"
    )
    bat_res = pd.DataFrame()
    try:
        r = session.get(bat_url, timeout=25)
        if "player_id" in r.text.lower():
            b_df = pd.read_csv(io.StringIO(r.text))
            b_df.columns = [c.lower().strip() for c in b_df.columns]

            id_col = next((c for c in b_df.columns if 'player_id' in c or 'id' in c), b_df.columns[0])
            b_df['player_id'] = pd.to_numeric(b_df[id_col], errors='coerce')
            b_df = b_df.dropna(subset=['player_id'])
            b_df['player_id'] = b_df['player_id'].astype(int)

            bat_col = next((c for c in b_df.columns if 'batting_run' in c or 'run_value' in c), None)
            br_col = next((c for c in b_df.columns if 'baserunning' in c or 'run_value_runner' in c), None)

            if bat_col:
                b_df['batting_run_value'] = pd.to_numeric(b_df[bat_col], errors='coerce')
                v_b = b_df.dropna(subset=['batting_run_value'])
                b_df.loc[v_b.index, 'batting_run_value'] = v_b['batting_run_value'].round(0).astype(int)
                b_df.loc[v_b.index, 'batting_run_value_percentile'] = (
                            v_b['batting_run_value'].rank(pct=True) * 100).round(0).astype(int)
            else:
                b_df['batting_run_value'] = None
                b_df['batting_run_value_percentile'] = None

            if br_col:
                b_df['baserunning_run_value'] = pd.to_numeric(b_df[br_col], errors='coerce')
                v_br = b_df.dropna(subset=['baserunning_run_value'])
                b_df.loc[v_br.index, 'baserunning_run_value'] = v_br['baserunning_run_value'].round(0).astype(int)
                b_df.loc[v_br.index, 'baserunning_run_value_percentile'] = (
                            v_br['baserunning_run_value'].rank(pct=True) * 100).round(0).astype(int)
            else:
                b_df['baserunning_run_value'] = None
                b_df['baserunning_run_value_percentile'] = None

            cols = ['player_id', 'batting_run_value', 'batting_run_value_percentile',
                    'baserunning_run_value', 'baserunning_run_value_percentile']
            bat_res = b_df[cols].drop_duplicates(subset=['player_id'])
            print(f" -> 타자 Run Value {len(bat_res)}명 확보 완료")
    except Exception as e:
        print(f"※ 타자 Run Value 수집 실패: {e}")

    # 4-2. 투수 런밸류
    pit_url = (
        f"https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=pitcher&filter=&sort=4&sortDir=desc&min=10&selections="
        f"player_id,pitching_run_value&csv=true"
    )
    pit_res = pd.DataFrame()
    try:
        r = session.get(pit_url, timeout=25)
        if "player_id" in r.text.lower():
            p_df = pd.read_csv(io.StringIO(r.text))
            p_df.columns = [c.lower().strip() for c in p_df.columns]

            id_col = next((c for c in p_df.columns if 'player_id' in c or 'id' in c), p_df.columns[0])
            p_df['player_id'] = pd.to_numeric(p_df[id_col], errors='coerce')
            p_df = p_df.dropna(subset=['player_id'])
            p_df['player_id'] = p_df['player_id'].astype(int)

            pit_col = next((c for c in p_df.columns if 'pitching_run' in c or 'run_value' in c), None)
            if pit_col:
                p_df['pitching_run_value'] = pd.to_numeric(p_df[pit_col], errors='coerce')
                v_p = p_df.dropna(subset=['pitching_run_value'])
                p_df.loc[v_p.index, 'pitching_run_value'] = v_p['pitching_run_value'].round(0).astype(int)
                p_df.loc[v_p.index, 'pitching_run_value_percentile'] = (
                            v_p['pitching_run_value'].rank(pct=True) * 100).round(0).astype(int)
                pit_res = p_df[['player_id', 'pitching_run_value', 'pitching_run_value_percentile']].drop_duplicates(
                    subset=['player_id'])
                print(f" -> 투수 Run Value {len(pit_res)}명 확보 완료")
    except Exception as e:
        print(f"※ 투수 Run Value 수집 실패: {e}")

    return bat_res, pit_res


# ----------------------------------------------------
# 5. MLB 공식 API: 도루, 볼넷%, 삼진%
# ----------------------------------------------------
def fetch_mlb_discipline_and_sb(season: int = 2024) -> pd.DataFrame:
    print(f"\n[5/5] [{season}] MLB 공식 API에서 도루(SB), BB%, K% 추출 중...")
    url = f"https://statsapi.mlb.com/api/v1/stats?stats=season&season={season}&group=hitting&sportId=1&limit=1500"
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
    splits = resp.json().get("stats", [{}])[0].get("splits", [])
    records = []
    for item in splits:
        p = item.get("player", {})
        s = item.get("stat", {})
        ab = int(s.get("atBats", 0))
        bb = int(s.get("baseOnBalls", 0))
        k = int(s.get("strikeOuts", 0))
        sb = int(s.get("stolenBases", 0))
        pa = ab + bb
        if pa < 10:
            continue
        bb_pct = round((bb / pa) * 100, 1)
        k_pct = round((k / pa) * 100, 1)
        records.append({
            "player_id": int(p.get("id")),
            "stolen_bases": sb,
            "bb_percentage": bb_pct,
            "k_percentage": k_pct
        })
    df = pd.DataFrame(records)
    print(f" -> 도루 및 BB%, K% {len(df)}명 확보 완료")
    return df


# ----------------------------------------------------
# DB 일괄 동기화
# ----------------------------------------------------
def run_advanced_collection(season: int = 2024):
    print("========================================================")
    print(f"[{season} 시즌] 세션 기반 Savant & MLB 전 지표 동기화 파이프라인")
    print("========================================================")

    speed_df = fetch_sprint_speed(season)
    oaa_df = fetch_fielding_oaa(season)
    arm_df = fetch_arm_strength(season)
    bat_val_df, pit_val_df = fetch_run_values(season)
    mlb_df = fetch_mlb_discipline_and_sb(season)

    print("\n>>> 데이터베이스(player_season_stats) 고속 일괄 반영 시작...")

    # 1. 도루 & 선구안
    if not mlb_df.empty:
        params = [
            {
                'sb': clean_val(r['stolen_bases'], to_int=True) or 0,
                'bb_pct': clean_val(r['bb_percentage']),
                'k_pct': clean_val(r['k_percentage']),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in mlb_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET stolen_bases  = :sb,
                                  bb_percentage = :bb_pct,
                                  k_percentage  = :k_pct
                              WHERE player_id = :pid
                                AND season = :season
                                AND is_pitcher = FALSE
                              """), params)
        print(" [OK] 1. 도루 및 선구안 일괄 반영 완료")

    # 2. Sprint Speed
    if not speed_df.empty:
        params = [
            {
                'spd': clean_val(r['sprint_speed']),
                'spd_pct': clean_val(r['sprint_speed_percentile'], to_int=True),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in speed_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET sprint_speed            = :spd,
                                  sprint_speed_percentile = :spd_pct
                              WHERE player_id = :pid
                                AND season = :season
                              """), params)
        print(" [OK] 2. Sprint Speed 일괄 반영 완료")

    # 3. OAA
    if not oaa_df.empty:
        params = [
            {
                'oaa': clean_val(r['outs_above_average'], to_int=True),
                'oaa_pct': clean_val(r['oaa_percentile'], to_int=True),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in oaa_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET outs_above_average = :oaa,
                                  oaa_percentile     = :oaa_pct
                              WHERE player_id = :pid
                                AND season = :season
                              """), params)
        print(" [OK] 3. OAA 일괄 반영 완료")

    # 4. Arm Strength
    if not arm_df.empty:
        params = [
            {
                'arm': clean_val(r['arm_strength']),
                'arm_pct': clean_val(r['arm_strength_percentile'], to_int=True),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in arm_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET arm_strength            = :arm,
                                  arm_strength_percentile = :arm_pct
                              WHERE player_id = :pid
                                AND season = :season
                              """), params)
        print(" [OK] 4. Arm Strength 일괄 반영 완료")

    # 5. 타자 Run Value
    if not bat_val_df.empty:
        params = [
            {
                'b_val': clean_val(r['batting_run_value'], to_int=True),
                'b_pct': clean_val(r['batting_run_value_percentile'], to_int=True),
                'br_val': clean_val(r['baserunning_run_value'], to_int=True),
                'br_pct': clean_val(r['baserunning_run_value_percentile'], to_int=True),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in bat_val_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET batting_run_value                = :b_val,
                                  batting_run_value_percentile     = :b_pct,
                                  baserunning_run_value            = :br_val,
                                  baserunning_run_value_percentile = :br_pct
                              WHERE player_id = :pid
                                AND season = :season
                                AND is_pitcher = FALSE
                              """), params)
        print(" [OK] 5. 타자 및 주루 Run Value 일괄 반영 완료")

    # 6. 투수 Run Value
    if not pit_val_df.empty:
        params = [
            {
                'val': clean_val(r['pitching_run_value'], to_int=True),
                'pct': clean_val(r['pitching_run_value_percentile'], to_int=True),
                'pid': int(r['player_id']),
                'season': season
            }
            for _, r in pit_val_df.iterrows()
        ]
        with engine.begin() as conn:
            conn.execute(text("""
                              UPDATE player_season_stats
                              SET pitching_run_value            = :val,
                                  pitching_run_value_percentile = :pct
                              WHERE player_id = :pid
                                AND season = :season
                                AND is_pitcher = TRUE
                              """), params)
        print(" [OK] 6. 투수 Run Value 일괄 반영 완료")

    print("\n========================================================")
    print(f">>> [{season} 시즌] 전체 지표 적재 완료!")
    print("========================================================")


if __name__ == "__main__":
    run_advanced_collection(season=2024)