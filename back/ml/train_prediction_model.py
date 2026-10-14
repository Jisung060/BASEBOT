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

FEATURE_COLS = [
    "diff_wrc_plus",
    "diff_xwoba",
    "diff_exit_velo",
    "diff_barrel_pct",
    "diff_hard_hit_pct",
    "diff_avg_bwar",
    "diff_era",
    "diff_fip",
    "diff_fastball_velo",
    "diff_pit_k_pct",
    "diff_team_oaa",
    "diff_sprint_speed",
]


def build_team_metrics(conn, season: int = 2024) -> pd.DataFrame:
    """구단별 타격, 투구, 수비, 주루 12대 세이버메트릭스 지표 통합 집계"""
    # 1. 타자 & 수비/주루 지표 (is_pitcher = FALSE)
    bat_query = text("""
        SELECT 
            p.team_id,
            AVG(s.wrc_plus) AS wrc_plus,
            AVG(s.xwoba) AS xwoba,
            AVG(s.avg_exit_velocity) AS avg_exit_velo,
            AVG(s.barrel_percentage) AS barrel_pct,
            AVG(s.hard_hit_percentage) AS hard_hit_pct,
            AVG(s.bwar) AS avg_bwar,
            SUM(COALESCE(s.outs_above_average, 0)) AS team_oaa,
            AVG(s.sprint_speed) AS sprint_speed,
            AVG(s.batting_avg) AS batting_avg
        FROM players p
        JOIN player_season_stats s ON p.player_id = s.player_id
        WHERE p.team_id IS NOT NULL AND s.season = :season AND s.is_pitcher = FALSE
        GROUP BY p.team_id
    """)
    bat_df = pd.read_sql(bat_query, conn, params={"season": season})

    # 2. 투수 지표 (is_pitcher = TRUE)
    pit_query = text("""
        SELECT 
            p.team_id,
            AVG(s.era) AS era,
            AVG(s.fip) AS fip,
            AVG(s.fastball_velocity) AS fastball_velo,
            AVG(s.k_percentage) AS pit_k_pct
        FROM players p
        JOIN player_season_stats s ON p.player_id = s.player_id
        WHERE p.team_id IS NOT NULL AND s.season = :season AND s.is_pitcher = TRUE
        GROUP BY p.team_id
    """)
    pit_df = pd.read_sql(pit_query, conn, params={"season": season})

    team_stats = pd.merge(bat_df, pit_df, on="team_id", how="outer")
    return team_stats.set_index("team_id")


def get_safe_stat(row, col: str, default: float) -> float:
    if row is None or col not in row or pd.isna(row[col]):
        return default
    return float(row[col])


def prepare_dataset():
    """종료된 경기 결과와 양 팀의 12대 세이버메트릭스 격차를 결합하여 학습 데이터셋 생성"""
    with engine.connect() as conn:
        team_metrics = build_team_metrics(conn, season=2024)

        games_query = text("""
            SELECT 
                game_id,
                game_date,
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
        h_id = row["home_team_id"]
        a_id = row["away_team_id"]

        h_stat = team_metrics.loc[h_id] if h_id in team_metrics.index else None
        a_stat = team_metrics.loc[a_id] if a_id in team_metrics.index else None

        # 타격 지표 추출
        h_wrc = get_safe_stat(h_stat, "wrc_plus", 100.0)
        a_wrc = get_safe_stat(a_stat, "wrc_plus", 100.0)

        h_xwoba = get_safe_stat(h_stat, "xwoba", 0.315)
        a_xwoba = get_safe_stat(a_stat, "xwoba", 0.315)

        h_velo = get_safe_stat(h_stat, "avg_exit_velo", 88.5)
        a_velo = get_safe_stat(a_stat, "avg_exit_velo", 88.5)

        h_barrel = get_safe_stat(h_stat, "barrel_pct", 7.5)
        a_barrel = get_safe_stat(a_stat, "barrel_pct", 7.5)

        h_hh = get_safe_stat(h_stat, "hard_hit_pct", 38.0)
        a_hh = get_safe_stat(a_stat, "hard_hit_pct", 38.0)

        h_bwar = get_safe_stat(h_stat, "avg_bwar", 1.2)
        a_bwar = get_safe_stat(a_stat, "avg_bwar", 1.2)

        # 투수 지표 추출
        h_era = get_safe_stat(h_stat, "era", 4.15)
        a_era = get_safe_stat(a_stat, "era", 4.15)

        h_fip = get_safe_stat(h_stat, "fip", 4.10)
        a_fip = get_safe_stat(a_stat, "fip", 4.10)

        h_fvelo = get_safe_stat(h_stat, "fastball_velo", 93.8)
        a_fvelo = get_safe_stat(a_stat, "fastball_velo", 93.8)

        h_k = get_safe_stat(h_stat, "pit_k_pct", 22.0)
        a_k = get_safe_stat(a_stat, "pit_k_pct", 22.0)

        # 수비/주루 지표 추출
        h_oaa = get_safe_stat(h_stat, "team_oaa", 0.0)
        a_oaa = get_safe_stat(a_stat, "team_oaa", 0.0)

        h_spd = get_safe_stat(h_stat, "sprint_speed", 27.0)
        a_spd = get_safe_stat(a_stat, "sprint_speed", 27.0)

        features.append({
            "game_id": row["game_id"],
            "diff_wrc_plus": h_wrc - a_wrc,
            "diff_xwoba": h_xwoba - a_xwoba,
            "diff_exit_velo": h_velo - a_velo,
            "diff_barrel_pct": h_barrel - a_barrel,
            "diff_hard_hit_pct": h_hh - a_hh,
            "diff_avg_bwar": h_bwar - a_bwar,
            "diff_era": h_era - a_era,
            "diff_fip": h_fip - a_fip,
            "diff_fastball_velo": h_fvelo - a_fvelo,
            "diff_pit_k_pct": h_k - a_k,
            "diff_team_oaa": h_oaa - a_oaa,
            "diff_sprint_speed": h_spd - a_spd,
            "target": row["target_home_win"]
        })

    return pd.DataFrame(features)


def train_and_save():
    print(">>> [고도화] 12대 세이버메트릭스 승부예측 데이터셋 구성 중...")
    data = prepare_dataset()
    print(f" -> 총 {len(data)}건의 경기 표본 데이터셋 확보")

    X = data[FEATURE_COLS]
    y = data["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, shuffle=True
    )

    print(">>> 모델 학습 중 (RandomForest Classifier - 12 Features)...")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
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

    # 피처 중요도 출력
    importances = sorted(zip(FEATURE_COLS, model.feature_importances_), key=lambda x: x[1], reverse=True)
    print("\n[주요 피처 중요도 TOP 5]")
    for feat, imp in importances[:5]:
        print(f"  * {feat}: {imp * 100:.1f}%")

    joblib.dump({"model": model, "features": FEATURE_COLS}, MODEL_PATH)
    print(f"\n>>> 고도화된 모델 가중치 파일 저장 완료: {MODEL_PATH}")


if __name__ == "__main__":
    train_and_save()