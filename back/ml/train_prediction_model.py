import os
import sys
from pathlib import Path

# 모듈 검색 경로에 back 폴더 추가
BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import text
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

from database.db_connection import engine

MODEL_DIR = Path(__file__).resolve().parent
MODEL_PATH = MODEL_DIR / "game_prediction_model.pkl"

# ★ Extension을 제외한 26대 핵심 세이버메트릭스 격차 피처 (Home - Away)
FEATURE_COLS = [
    # 1. 타격 & 배트 트래킹 (8종)
    "diff_wrc_plus",
    "diff_batting_rv",
    "diff_xwoba",
    "diff_bat_speed",
    "diff_squared_up_pct",
    "diff_exit_velo",
    "diff_barrel_pct",
    "diff_hard_hit_pct",
    # 2. 마운드 & 구종 가치 (12종 - Extension 제외)
    "diff_pitching_rv",
    "diff_fb_rv",
    "diff_brk_rv",
    "diff_off_rv",
    "diff_era",
    "diff_fip",
    "diff_xera",
    "diff_pit_xba",
    "diff_fastball_velo",
    "diff_pit_k_pct",
    "diff_pit_whiff_pct",
    "diff_pit_gb_pct",
    # 3. 수비 · 포수 프레이밍 · 주루 · WAR (6종)
    "diff_fielding_rv",
    "diff_team_oaa",
    "diff_arm_value",
    "diff_framing_runs",
    "diff_bsr_rv",
    "diff_sprint_speed",
    "diff_avg_bwar",
]

DEFAULT_METRICS = {
    "wrc_plus": 100.0,
    "batting_rv": 0.0,
    "xwoba": 0.315,
    "xba": 0.245,
    "xslg": 0.410,
    "bat_speed": 71.5,
    "squared_up_pct": 25.0,
    "avg_exit_velo": 88.8,
    "barrel_pct": 7.8,
    "hard_hit_pct": 39.0,
    "pitching_rv": 0.0,
    "fb_rv": 0.0,
    "brk_rv": 0.0,
    "off_rv": 0.0,
    "era": 4.15,
    "fip": 4.12,
    "xera": 4.15,
    "pit_xba": 0.245,
    "fastball_velo": 93.9,
    "pit_k_pct": 22.3,
    "pit_whiff_pct": 25.0,
    "pit_gb_pct": 42.5,
    "fielding_rv": 0.0,
    "team_oaa": 0.0,
    "arm_value": 0.0,
    "framing_runs": 0.0,
    "bsr_rv": 0.0,
    "sprint_speed": 27.0,
    "avg_bwar": 0.25,
}


def build_team_metrics(conn, season: int = 2024) -> pd.DataFrame:
    """해당 시즌 구단별 타격, 배트트래킹, 투구, 구종가치, 수비, 포수, 주루 전 지표 통합 집계"""
    bat_query = text("""
        SELECT 
            COALESCE(s.team_id, p.team_id) AS team_id,
            AVG(s.wrc_plus) AS wrc_plus,
            SUM(COALESCE(s.batting_run_value, 0)) AS batting_rv,
            AVG(s.xwoba) AS xwoba,
            AVG(s.xba) AS xba,
            AVG(s.xslg) AS xslg,
            AVG(s.bat_speed) AS bat_speed,
            AVG(s.squared_up_percentage) AS squared_up_pct,
            AVG(s.avg_exit_velocity) AS avg_exit_velo,
            AVG(s.barrel_percentage) AS barrel_pct,
            AVG(s.hard_hit_percentage) AS hard_hit_pct,
            SUM(COALESCE(s.fielding_run_value, 0)) AS fielding_rv,
            SUM(COALESCE(s.outs_above_average, 0)) AS team_oaa,
            SUM(COALESCE(s.arm_value, 0)) AS arm_value,
            SUM(COALESCE(s.framing_runs, 0)) AS framing_runs,
            SUM(COALESCE(s.baserunning_run_value, 0)) AS bsr_rv,
            AVG(s.sprint_speed) AS sprint_speed,
            AVG(s.bwar) AS avg_bwar
        FROM player_season_stats s
        JOIN players p ON p.player_id = s.player_id
        WHERE COALESCE(s.team_id, p.team_id) IS NOT NULL
          AND s.season = :season
          AND s.is_pitcher = FALSE
          AND s.games > 0
        GROUP BY COALESCE(s.team_id, p.team_id)
    """)
    bat_df = pd.read_sql(bat_query, conn, params={"season": season})

    pit_query = text("""
        SELECT 
            COALESCE(s.team_id, p.team_id) AS team_id,
            SUM(COALESCE(s.pitching_run_value, 0)) AS pitching_rv,
            SUM(COALESCE(s.fastball_run_value, 0)) AS fb_rv,
            SUM(COALESCE(s.breaking_run_value, 0)) AS brk_rv,
            SUM(COALESCE(s.offspeed_run_value, 0)) AS off_rv,
            AVG(s.era) AS era,
            AVG(s.fip) AS fip,
            AVG(s.xera) AS xera,
            AVG(s.xba) AS pit_xba,
            AVG(s.fastball_velocity) AS fastball_velo,
            AVG(s.k_percentage) AS pit_k_pct,
            AVG(s.whiff_percentage) AS pit_whiff_pct,
            AVG(s.gb_percentage) AS pit_gb_pct
        FROM player_season_stats s
        JOIN players p ON p.player_id = s.player_id
        WHERE COALESCE(s.team_id, p.team_id) IS NOT NULL
          AND s.season = :season
          AND s.is_pitcher = TRUE
          AND s.games > 0
        GROUP BY COALESCE(s.team_id, p.team_id)
    """)
    pit_df = pd.read_sql(pit_query, conn, params={"season": season})

    team_stats = pd.merge(bat_df, pit_df, on="team_id", how="outer")
    return team_stats.set_index("team_id")


def get_safe_stat(row, col: str) -> float:
    default = DEFAULT_METRICS.get(col, 0.0)
    if row is None or col not in row or pd.isna(row[col]):
        return default
    return float(row[col])


def compute_feature_diff_dict(h_stat, a_stat) -> dict:
    """홈팀과 원정팀의 세이버메트릭스 지표 격차(Home - Away) 딕셔너리 산출"""
    return {
        "diff_wrc_plus": get_safe_stat(h_stat, "wrc_plus") - get_safe_stat(a_stat, "wrc_plus"),
        "diff_batting_rv": get_safe_stat(h_stat, "batting_rv") - get_safe_stat(a_stat, "batting_rv"),
        "diff_xwoba": get_safe_stat(h_stat, "xwoba") - get_safe_stat(a_stat, "xwoba"),
        "diff_bat_speed": get_safe_stat(h_stat, "bat_speed") - get_safe_stat(a_stat, "bat_speed"),
        "diff_squared_up_pct": get_safe_stat(h_stat, "squared_up_pct") - get_safe_stat(a_stat, "squared_up_pct"),
        "diff_exit_velo": get_safe_stat(h_stat, "avg_exit_velo") - get_safe_stat(a_stat, "avg_exit_velo"),
        "diff_barrel_pct": get_safe_stat(h_stat, "barrel_pct") - get_safe_stat(a_stat, "barrel_pct"),
        "diff_hard_hit_pct": get_safe_stat(h_stat, "hard_hit_pct") - get_safe_stat(a_stat, "hard_hit_pct"),
        "diff_pitching_rv": get_safe_stat(h_stat, "pitching_rv") - get_safe_stat(a_stat, "pitching_rv"),
        "diff_fb_rv": get_safe_stat(h_stat, "fb_rv") - get_safe_stat(a_stat, "fb_rv"),
        "diff_brk_rv": get_safe_stat(h_stat, "brk_rv") - get_safe_stat(a_stat, "brk_rv"),
        "diff_off_rv": get_safe_stat(h_stat, "off_rv") - get_safe_stat(a_stat, "off_rv"),
        "diff_era": get_safe_stat(h_stat, "era") - get_safe_stat(a_stat, "era"),
        "diff_fip": get_safe_stat(h_stat, "fip") - get_safe_stat(a_stat, "fip"),
        "diff_xera": get_safe_stat(h_stat, "xera") - get_safe_stat(a_stat, "xera"),
        "diff_pit_xba": get_safe_stat(h_stat, "pit_xba") - get_safe_stat(a_stat, "pit_xba"),
        "diff_fastball_velo": get_safe_stat(h_stat, "fastball_velo") - get_safe_stat(a_stat, "fastball_velo"),
        "diff_pit_k_pct": get_safe_stat(h_stat, "pit_k_pct") - get_safe_stat(a_stat, "pit_k_pct"),
        "diff_pit_whiff_pct": get_safe_stat(h_stat, "pit_whiff_pct") - get_safe_stat(a_stat, "pit_whiff_pct"),
        "diff_pit_gb_pct": get_safe_stat(h_stat, "pit_gb_pct") - get_safe_stat(a_stat, "pit_gb_pct"),
        "diff_fielding_rv": get_safe_stat(h_stat, "fielding_rv") - get_safe_stat(a_stat, "fielding_rv"),
        "diff_team_oaa": get_safe_stat(h_stat, "team_oaa") - get_safe_stat(a_stat, "team_oaa"),
        "diff_arm_value": get_safe_stat(h_stat, "arm_value") - get_safe_stat(a_stat, "arm_value"),
        "diff_framing_runs": get_safe_stat(h_stat, "framing_runs") - get_safe_stat(a_stat, "framing_runs"),
        "diff_bsr_rv": get_safe_stat(h_stat, "bsr_rv") - get_safe_stat(a_stat, "bsr_rv"),
        "diff_sprint_speed": get_safe_stat(h_stat, "sprint_speed") - get_safe_stat(a_stat, "sprint_speed"),
        "diff_avg_bwar": get_safe_stat(h_stat, "avg_bwar") - get_safe_stat(a_stat, "avg_bwar"),
    }


def prepare_dataset():
    """종료된 모든 시즌 경기 결과와 해당 시즌 양 팀의 27개 세이버메트릭스 격차를 결합하여 학습 데이터셋 생성"""
    with engine.connect() as conn:
        avail_seasons = conn.execute(
            text("SELECT DISTINCT season FROM player_season_stats WHERE season IS NOT NULL ORDER BY season DESC")
        ).scalars().all()
        avail_seasons = [int(s) for s in avail_seasons] or [2024]
        fallback_season = avail_seasons[0]

        season_metrics_map = {s: build_team_metrics(conn, season=s) for s in avail_seasons}

        games_query = text("""
            SELECT 
                game_id,
                YEAR(game_date) AS game_season,
                home_team_id,
                away_team_id,
                home_score,
                away_score
            FROM games
            WHERE status = 'FINAL' AND home_score != away_score
            ORDER BY game_date ASC
        """)
        games_df = pd.read_sql(games_query, conn)

    if games_df.empty:
        raise ValueError("학습에 사용할 종료된 경기(FINAL) 데이터가 부족합니다.")

    games_df["target_home_win"] = (games_df["home_score"] > games_df["away_score"]).astype(int)

    features = []
    for _, row in games_df.iterrows():
        g_season = int(row["game_season"]) if pd.notna(row["game_season"]) else fallback_season
        team_metrics = season_metrics_map.get(g_season)
        if team_metrics is None or team_metrics.empty:
            team_metrics = season_metrics_map[fallback_season]

        h_id = row["home_team_id"]
        a_id = row["away_team_id"]

        h_stat = team_metrics.loc[h_id] if h_id in team_metrics.index else None
        a_stat = team_metrics.loc[a_id] if a_id in team_metrics.index else None

        feat_row = compute_feature_diff_dict(h_stat, a_stat)
        feat_row["game_id"] = row["game_id"]
        feat_row["target"] = row["target_home_win"]
        features.append(feat_row)

    return pd.DataFrame(features)


def train_and_save():
    print(">>> [고도화] 27개 세이버메트릭스 피처(Extension 제외 전 지표) 승부예측 데이터셋 구성 중...")
    data = prepare_dataset()
    print(f" -> 총 {len(data)}건의 종료 경기 표본 데이터셋 확보")

    X = data[FEATURE_COLS]
    y = data["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, shuffle=True
    )

    print(f">>> 모델 학습 중 (RandomForest Classifier - {len(FEATURE_COLS)} Features)...")
    model = RandomForestClassifier(
        n_estimators=250,
        max_depth=7,
        min_samples_split=4,
        min_samples_leaf=2,
        random_state=42
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_test, preds)
    try:
        auc = roc_auc_score(y_test, probs)
    except Exception:
        auc = 0.5

    print(f" -> 검증 세트 정확도 (Accuracy): {acc * 100:.2f}%")
    print(f" -> ROC-AUC Score: {auc:.3f}")

    importances = sorted(zip(FEATURE_COLS, model.feature_importances_), key=lambda x: x[1], reverse=True)
    print("\n[주요 피처 중요도 TOP 8]")
    for feat, imp in importances[:8]:
        print(f"  * {feat}: {imp * 100:.1f}%")

    joblib.dump({"model": model, "features": FEATURE_COLS}, MODEL_PATH)
    print(f"\n>>> 고도화된 모델 가중치 파일 저장 완료: {MODEL_PATH}")


if __name__ == "__main__":
    train_and_save()