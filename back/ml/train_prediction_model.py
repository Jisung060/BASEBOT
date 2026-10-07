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

def build_team_metrics(conn) -> pd.DataFrame:
    """구단별 평균 타구속도, 배럴타구비율, 평균 bWAR 집계"""
    query = text("""
        SELECT 
            p.team_id,
            AVG(s.bwar) AS avg_bwar,
            AVG(s.avg_exit_velocity) AS team_exit_velo,
            AVG(s.barrel_percentage) AS team_barrel_pct,
            AVG(s.hard_hit_percentage) AS team_hard_hit_pct,
            AVG(s.batting_avg) AS team_batting_avg,
            SUM(s.home_runs) AS team_total_hr
        FROM players p
        JOIN player_season_stats s ON p.player_id = s.player_id
        WHERE p.team_id IS NOT NULL AND s.season = 2024
        GROUP BY p.team_id
    """)
    team_stats = pd.read_sql(query, conn)
    return team_stats.set_index("team_id")

def prepare_dataset():
    """경기 결과와 팀 세이버 지표를 결합하여 학습용 데이터셋 생성"""
    with engine.connect() as conn:
        team_metrics = build_team_metrics(conn)

        # FINAL 상태인 경기 데이터 조회
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

    # 타깃 레이블 생성: 홈팀 승리 시 1, 패배 시 0
    games_df["target_home_win"] = (games_df["home_score"] > games_df["away_score"]).astype(int)

    features = []
    for _, row in games_df.iterrows():
        h_id = row["home_team_id"]
        a_id = row["away_team_id"]

        h_stat = team_metrics.loc[h_id] if h_id in team_metrics.index else None
        a_stat = team_metrics.loc[a_id] if a_id in team_metrics.index else None

        # 팀 지표 결측치 방어
        h_bwar = h_stat["avg_bwar"] if h_stat is not None else 0.0
        a_bwar = a_stat["avg_bwar"] if a_stat is not None else 0.0

        h_velo = h_stat["team_exit_velo"] if h_stat is not None else 88.0
        a_velo = a_stat["team_exit_velo"] if a_stat is not None else 88.0

        h_barrel = h_stat["team_barrel_pct"] if h_stat is not None else 6.0
        a_barrel = a_stat["team_barrel_pct"] if a_stat is not None else 6.0

        h_ba = h_stat["team_batting_avg"] if h_stat is not None else 0.240
        a_ba = a_stat["team_batting_avg"] if a_stat is not None else 0.240

        # 피처: 홈팀 지표 - 원정팀 지표 (상대적 우위 격차)
        features.append({
            "game_id": row["game_id"],
            "diff_avg_bwar": h_bwar - a_bwar,
            "diff_exit_velo": h_velo - a_velo,
            "diff_barrel_pct": h_barrel - a_barrel,
            "diff_batting_avg": h_ba - a_ba,
            "target": row["target_home_win"]
        })

    df = pd.DataFrame(features)
    return df

def train_and_save():
    print(">>> 승부예측 머신러닝 데이터셋 구성 중...")
    data = prepare_dataset()
    print(f" -> 총 {len(data)}건의 경기 표본 데이터셋 확보")

    feature_cols = ["diff_avg_bwar", "diff_exit_velo", "diff_barrel_pct", "diff_batting_avg"]
    X = data[feature_cols]
    y = data["target"]

    # 학습 / 검증 데이터 분할
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, shuffle=True)

    print(">>> 모델 학습 중 (RandomForest Classifier)...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=5,
        min_samples_split=4,
        random_state=42
    )
    model.fit(X_train, y_train)

    # 평가
    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_test, preds)
    try:
        auc = roc_auc_score(y_test, probs)
    except Exception:
        auc = 0.5

    print(f" -> 검증 세트 정확도 (Accuracy): {acc * 100:.2f}%")
    print(f" -> ROC-AUC Score: {auc:.3f}")

    # 모델 직렬화 저장
    joblib.dump({"model": model, "features": feature_cols}, MODEL_PATH)
    print(f">>> 모델 가중치 파일 저장 완료: {MODEL_PATH}")

if __name__ == "__main__":
    train_and_save()