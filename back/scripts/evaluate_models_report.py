"""
발표자료 및 기술 문서 작성용 BASEBOT AI 모델(ML 승부예측 & DL 선수 성적 예측)
통합 성능 평가(Test Score) 산출 스크립트.

실행 방법:
    python back/scripts/evaluate_models_report.py
"""

import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import numpy as np
import torch
import torch.nn as nn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from ml.train_prediction_model import FEATURE_COLS, prepare_dataset
from services.player_dl_predictor import (
    BATTER_FEATURES,
    BATTER_TARGETS,
    PITCHER_FEATURES,
    PITCHER_TARGETS,
    PlayerStatMLP,
    _build_training_pairs,
)


def evaluate_ml_matchup_model():
    print("\n" + "=" * 72)
    print(" 1. [ML 팀 승부예측 모델] Random Forest Classifier 테스트 결과")
    print("=" * 72)

    data = prepare_dataset()
    X = data[FEATURE_COLS]
    y = data["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, shuffle=True
    )

    model = RandomForestClassifier(
        n_estimators=250,
        max_depth=7,
        min_samples_split=4,
        min_samples_leaf=2,
        random_state=42,
    )
    model.fit(X_train, y_train)

    train_preds = model.predict(X_train)
    test_preds = model.predict(X_test)
    test_probs = model.predict_proba(X_test)[:, 1]

    train_acc = accuracy_score(y_train, train_preds) * 100
    test_acc = accuracy_score(y_test, test_preds) * 100
    prec = precision_score(y_test, test_preds, zero_division=0) * 100
    rec = recall_score(y_test, test_preds, zero_division=0) * 100
    f1 = f1_score(y_test, test_preds, zero_division=0) * 100
    try:
        auc = roc_auc_score(y_test, test_probs)
    except Exception:
        auc = 0.5

    # 5-Fold 교차 검증 정확도
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X, y, cv=cv, scoring="accuracy")

    print(f"- 전체 경기 표본 수 : {len(data)} 경기 (Train: {len(X_train)} / Test: {len(X_test)})")
    print(f"- 입력 피처 수      : {len(FEATURE_COLS)}개 세이버메트릭스 격차 피처")
    print(f"- Train Accuracy    : {train_acc:.2f}%")
    print(f"- Test Accuracy     : {test_acc:.2f}%")
    print(f"- 5-Fold CV 평균    : {cv_scores.mean() * 100:.2f}% (±{cv_scores.std() * 100:.2f}%)")
    print(f"- Test Precision    : {prec:.2f}%")
    print(f"- Test Recall       : {rec:.2f}%")
    print(f"- Test F1-Score     : {f1:.2f}%")
    print(f"- Test ROC-AUC      : {auc:.4f}")

    importances = sorted(zip(FEATURE_COLS, model.feature_importances_), key=lambda x: x[1], reverse=True)
    print("\n[피처 중요도(Feature Importance) TOP 10]")
    for rank, (feat, imp) in enumerate(importances[:10], 1):
        print(f"  {rank:2d}. {feat:<22} : {imp * 100:5.2f}%")


def evaluate_dl_role_model(is_pitcher: bool, epochs: int = 180):
    role_title = "투수 (Pitcher)" if is_pitcher else "타자 (Batter)"
    feature_cols = PITCHER_FEATURES if is_pitcher else BATTER_FEATURES
    target_cols = PITCHER_TARGETS if is_pitcher else BATTER_TARGETS

    X, Y = _build_training_pairs(is_pitcher=is_pitcher)

    # 80% Train / 20% Test 분할 평가
    X_train, X_test, Y_train, Y_test = train_test_split(
        X, Y, test_size=0.2, random_state=42, shuffle=True
    )

    x_mean = X_train.mean(axis=0)
    x_std = X_train.std(axis=0) + 1e-6
    y_mean = Y_train.mean(axis=0)
    y_std = Y_train.std(axis=0) + 1e-6

    X_train_norm = (X_train - x_mean) / x_std
    Y_train_norm = (Y_train - y_mean) / y_std
    X_test_norm = (X_test - x_mean) / x_std
    Y_test_norm = (Y_test - y_mean) / y_std

    torch.manual_seed(42)
    model = PlayerStatMLP(X.shape[1], Y.shape[1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.004, weight_decay=1e-4)
    criterion = nn.HuberLoss()

    x_tr_t = torch.from_numpy(X_train_norm)
    y_tr_t = torch.from_numpy(Y_train_norm)
    x_te_t = torch.from_numpy(X_test_norm)
    y_te_t = torch.from_numpy(Y_test_norm)

    model.train()
    batch_size = min(64, len(X_train))
    for _ in range(epochs):
        perm = torch.randperm(len(X_train))
        for i in range(0, len(X_train), batch_size):
            idx = perm[i : i + batch_size]
            optimizer.zero_grad()
            pred = model(x_tr_t[idx])
            loss = criterion(pred, y_tr_t[idx])
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        train_loss = float(criterion(model(x_tr_t), y_tr_t).item())
        pred_test_norm = model(x_te_t)
        test_loss = float(criterion(pred_test_norm, y_te_t).item())
        Y_pred = pred_test_norm.numpy() * y_std + y_mean

    overall_r2 = r2_score(Y_test, Y_pred, multioutput="uniform_average")

    print("\n" + "=" * 72)
    print(f" 2. [PyTorch DL 선수 성적 예측 모델] {role_title} MLP 테스트 결과")
    print("=" * 72)
    print(f"- 데이터 표본 수     : 총 {len(X)}건 (Train: {len(X_train)} / Test: {len(X_test)})")
    print(f"- 입출력 차원        : Input {len(feature_cols)}차원 -> Hidden (64 -> 32) -> Output {len(target_cols)}차원")
    print(f"- Train Huber Loss   : {train_loss:.4f}")
    print(f"- Test Huber Loss    : {test_loss:.4f}")
    print(f"- 종합 평균 R² Score : {overall_r2:.4f} ({overall_r2 * 100:.2f}% 설명력)")

    print(f"\n[{role_title} 타깃 지표별 상세 테스트 성능 (Test Set)]")
    print(f"{'타깃 지표 (Target)':<20} | {'MAE (평균절대오차)':<18} | {'RMSE (평균제곱근오차)':<20} | {'R² Score':<10}")
    print("-" * 76)
    for idx, col in enumerate(target_cols):
        y_t = Y_test[:, idx]
        y_p = Y_pred[:, idx]
        mae = mean_absolute_error(y_t, y_p)
        rmse = np.sqrt(mean_squared_error(y_t, y_p))
        r2 = r2_score(y_t, y_p)
        fmt = ".3f" if col in ("batting_avg", "obp", "slg", "ops", "era", "fip", "whip") else ".2f"
        print(f"{col:<20} | {mae:<18{fmt}} | {rmse:<20{fmt}} | {r2:<10.4f}")


if __name__ == "__main__":
    evaluate_ml_matchup_model()
    evaluate_dl_role_model(is_pitcher=False)
    evaluate_dl_role_model(is_pitcher=True)