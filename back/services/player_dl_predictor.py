"""
PyTorch Deep Learning (MLP) 기반 MLB 타자/투수 시즌 성적 예측 엔진.
- 선수 상세 페이지(Playground) 및 AI 챗봇(chat_service) 양쪽에서 공통으로 사용합니다.
- CLI에서 직접 실행(`python back/services/player_dl_predictor.py`)하면 DB 전체 시즌 데이터로 재학습합니다.
"""

from __future__ import annotations

import math
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Optional

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import engine

MODEL_PT_PATH = Path(__file__).resolve().parent / "player_dl_models.pt"

# ---------------------------------------------------------
# 1. 입력 피처(Features) 및 출력 타깃(Targets) 정의
# ---------------------------------------------------------
BATTER_FEATURES = [
    "age",
    "games",
    "batting_avg",
    "obp",
    "slg",
    "ops",
    "home_runs",
    "rbi",
    "stolen_bases",
    "wrc_plus",
    "bwar",
    "fwar",
    "xba",
    "xslg",
    "xwoba",
    "avg_exit_velocity",
    "barrel_percentage",
    "hard_hit_percentage",
    "sweet_spot_percentage",
    "bat_speed",
    "squared_up_percentage",
    "k_percentage",
    "bb_percentage",
    "chase_percentage",
    "whiff_percentage",
    "sprint_speed",
]

BATTER_TARGETS = [
    "batting_avg",
    "obp",
    "slg",
    "ops",
    "home_runs",
    "rbi",
    "stolen_bases",
    "wrc_plus",
    "bwar",
    "fwar",
]

PITCHER_FEATURES = [
    "age",
    "games",
    "innings_pitched",
    "wins",
    "losses",
    "era",
    "fip",
    "xera",
    "whip",
    "strikeouts",
    "walks",
    "bwar",
    "fwar",
    "xba",
    "fastball_velocity",
    "avg_exit_velocity",
    "barrel_percentage",
    "hard_hit_percentage",
    "k_percentage",
    "bb_percentage",
    "whiff_percentage",
    "chase_percentage",
    "gb_percentage",
    "pitching_run_value",
]

PITCHER_TARGETS = [
    "era",
    "fip",
    "whip",
    "wins",
    "losses",
    "innings_pitched",
    "strikeouts",
    "bwar",
    "fwar",
]

BATTER_DEFAULTS = {
    "age": 28.0, "games": 120.0, "batting_avg": 0.248, "obp": 0.315, "slg": 0.410, "ops": 0.725,
    "home_runs": 15.0, "rbi": 55.0, "stolen_bases": 6.0, "wrc_plus": 100.0, "bwar": 1.2, "fwar": 1.4,
    "xba": 0.245, "xslg": 0.410, "xwoba": 0.315, "avg_exit_velocity": 88.8, "barrel_percentage": 7.8,
    "hard_hit_percentage": 39.0, "sweet_spot_percentage": 33.5, "bat_speed": 71.5, "squared_up_percentage": 25.0,
    "k_percentage": 22.5, "bb_percentage": 8.2, "chase_percentage": 28.5, "whiff_percentage": 25.0, "sprint_speed": 27.0,
}

PITCHER_DEFAULTS = {
    "age": 28.0, "games": 30.0, "innings_pitched": 90.0, "wins": 6.0, "losses": 6.0,
    "era": 4.15, "fip": 4.12, "xera": 4.15, "whip": 1.28, "strikeouts": 85.0, "walks": 30.0,
    "bwar": 1.0, "fwar": 1.1, "xba": 0.245, "fastball_velocity": 93.9, "avg_exit_velocity": 88.8,
    "barrel_percentage": 7.8, "hard_hit_percentage": 39.0, "k_percentage": 22.3, "bb_percentage": 8.2,
    "whiff_percentage": 25.0, "chase_percentage": 28.5, "gb_percentage": 42.5, "pitching_run_value": 0.0,
}

# 한국어 선수 별칭 사전 (챗봇에서 한글로 질문할 때 자동 매핑)
KOR_PLAYER_ALIASES = {
    "오타니": "Shohei Ohtani",
    "오타니 쇼헤이": "Shohei Ohtani",
    "애런 저지": "Aaron Judge",
    "저지": "Aaron Judge",
    "스탠튼": "Giancarlo Stanton",
    "지안카를로 스탠튼": "Giancarlo Stanton",
    "소토": "Juan Soto",
    "후안 소토": "Juan Soto",
    "베츠": "Mookie Betts",
    "무키 베츠": "Mookie Betts",
    "프리먼": "Freddie Freeman",
    "프레디 프리먼": "Freddie Freeman",
    "하퍼": "Bryce Harper",
    "브라이스 하퍼": "Bryce Harper",
    "트라웃": "Mike Trout",
    "마이크 트라웃": "Mike Trout",
    "린도어": "Francisco Lindor",
    "위트 주니어": "Bobby Witt Jr.",
    "바비 위트": "Bobby Witt Jr.",
    "거너 헨더슨": "Gunnar Henderson",
    "헨더슨": "Gunnar Henderson",
    "산체스": "Gary Sánchez",
    "개리 산체스": "Gary Sánchez",
    "치좀": "Jazz Chisholm Jr.",
    "재즈 치좀": "Jazz Chisholm Jr.",
    "디그롬": "Jacob deGrom",
    "제이콥 디그롬": "Jacob deGrom",
    "콜": "Gerrit Cole",
    "게릿 콜": "Gerrit Cole",
    "프리드": "Max Fried",
    "맥스 프리드": "Max Fried",
    "크로셰": "Garrett Crochet",
    "개럿 크로셰": "Garrett Crochet",
    "스쿠발": "Tarik Skubal",
    "타릭 스쿠발": "Tarik Skubal",
    "스킨스": "Paul Skenes",
    "폴 스킨스": "Paul Skenes",
    "야마모토": "Yoshinobu Yamamoto",
    "이정후": "Jung Hoo Lee",
    "김하성": "Ha-Seong Kim",
    "류현진": "Hyun Jin Ryu",
}


# ---------------------------------------------------------
# 2. PyTorch 다층 신경망(MLP) 아키텍처
# ---------------------------------------------------------
class PlayerStatMLP(nn.Module):
    def __init__(self, in_features: int, out_targets: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_features, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(64, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Linear(32, out_targets),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


# ---------------------------------------------------------
# 3. 유틸리티 및 전처리 함수
# ---------------------------------------------------------
def _calc_age_at_season(birth_date_val: Any, season_year: int) -> float:
    if not birth_date_val:
        return 28.0
    try:
        b_year = int(str(birth_date_val)[:4])
        return float(max(19, min(45, season_year - b_year)))
    except Exception:
        return 28.0


def _enrich_slash_line(row_dict: dict[str, Any]) -> dict[str, Any]:
    """DB에 obp, slg, ops가 비어 있는 과거 행도 안전하게 보완"""
    d = dict(row_dict)
    avg = d.get("batting_avg")
    avg_f = float(avg) if avg is not None and not pd.isna(avg) else 0.248
    if d.get("obp") is None or pd.isna(d.get("obp")):
        bb_pct = float(d.get("bb_percentage") or 8.0) / 100.0
        d["obp"] = round(min(0.480, avg_f + bb_pct * 0.8), 3)
    if d.get("slg") is None or pd.isna(d.get("slg")):
        d["slg"] = float(d["xslg"]) if d.get("xslg") is not None and not pd.isna(d.get("xslg")) else round(avg_f * 1.62, 3)
    if d.get("ops") is None or pd.isna(d.get("ops")):
        d["ops"] = round(float(d["obp"]) + float(d["slg"]), 3)
    return d


def _weighted_prev_features(
    prior_rows: list[dict[str, Any]],
    feature_cols: list[str],
    defaults: dict[str, float],
    target_season: int,
    birth_date_val: Any,
) -> np.ndarray:
    """직전 최대 3개 시즌 기록에 최근성 가중치(5:3:2)를 부여해 입력 벡터 생성"""
    weights = [0.55, 0.30, 0.15][: len(prior_rows)]
    w_sum = sum(weights)
    weights = [w / w_sum for w in weights]

    vec = []
    for col in feature_cols:
        if col == "age":
            vec.append(_calc_age_at_season(birth_date_val, target_season))
            continue

        val_acc = 0.0
        valid_w = 0.0
        for w, r in zip(weights, prior_rows):
            v = r.get(col)
            if v is not None and not pd.isna(v):
                val_acc += float(v) * w
                valid_w += w
        if valid_w > 0:
            vec.append(val_acc / valid_w)
        else:
            vec.append(defaults.get(col, 0.0))

    return np.array(vec, dtype=np.float32)


# ---------------------------------------------------------
# 4. PyTorch 모델 학습 파이프라인
# ---------------------------------------------------------
def _build_training_pairs(is_pitcher: bool) -> tuple[np.ndarray, np.ndarray]:
    feature_cols = PITCHER_FEATURES if is_pitcher else BATTER_FEATURES
    target_cols = PITCHER_TARGETS if is_pitcher else BATTER_TARGETS
    defaults = PITCHER_DEFAULTS if is_pitcher else BATTER_DEFAULTS

    with engine.connect() as conn:
        sql = text("""
            SELECT s.*, p.birth_date
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            WHERE s.is_pitcher = :is_pit AND s.games >= :min_g
            ORDER BY s.player_id ASC, s.season ASC
        """)
        rows = conn.execute(sql, {"is_pit": is_pitcher, "min_g": 15 if is_pitcher else 30}).mappings().all()

    by_player: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        d = _enrich_slash_line(dict(r)) if not is_pitcher else dict(r)
        by_player.setdefault(int(d["player_id"]), []).append(d)

    X_list, Y_list = [], []

    # 1) 연속 시즌(T-1, T-2 -> T) 실제 전이 데이터 추출
    for pid, p_rows in by_player.items():
        if len(p_rows) >= 2:
            for idx in range(1, len(p_rows)):
                target_row = p_rows[idx]
                priors = list(reversed(p_rows[max(0, idx - 3) : idx]))
                t_season = int(target_row["season"])
                b_date = target_row.get("birth_date")

                x_vec = _weighted_prev_features(priors, feature_cols, defaults, t_season, b_date)
                y_vec = [
                    float(target_row.get(c)) if target_row.get(c) is not None and not pd.isna(target_row.get(c)) else defaults[c]
                    for c in target_cols
                ]
                X_list.append(x_vec)
                Y_list.append(np.array(y_vec, dtype=np.float32))

        # 2) 단일 시즌만 있는 경우 세이버메트릭스 기대지표(xBA, xwOBA, xERA, FIP)로의 평균 회귀(Regression to the Mean) 자기지도 샘플 보강
        for r in p_rows:
            t_season = int(r["season"]) + 1
            b_date = r.get("birth_date")
            x_vec = _weighted_prev_features([r], feature_cols, defaults, t_season, b_date)
            age_next = _calc_age_at_season(b_date, t_season)
            aging_factor = 1.0 - max(0.0, (age_next - 30.0) * 0.012)

            y_synth = []
            for c in target_cols:
                cur_v = float(r.get(c)) if r.get(c) is not None and not pd.isna(r.get(c)) else defaults[c]
                if not is_pitcher and c == "batting_avg" and r.get("xba"):
                    y_synth.append(0.55 * float(r["xba"]) + 0.30 * cur_v + 0.15 * defaults[c])
                elif not is_pitcher and c == "slg" and r.get("xslg"):
                    y_synth.append((0.55 * float(r["xslg"]) + 0.30 * cur_v + 0.15 * defaults[c]) * aging_factor)
                elif is_pitcher and c == "era":
                    xera_v = float(r.get("xera") or r.get("fip") or cur_v)
                    y_synth.append(0.50 * xera_v + 0.30 * cur_v + 0.20 * defaults[c])
                else:
                    y_synth.append(0.75 * cur_v * aging_factor + 0.25 * defaults[c])
            X_list.append(x_vec)
            Y_list.append(np.array(y_synth, dtype=np.float32))

    return np.vstack(X_list), np.vstack(Y_list)


def _train_single_role_mlp(is_pitcher: bool, epochs: int = 180) -> dict[str, Any]:
    X, Y = _build_training_pairs(is_pitcher)
    x_mean = X.mean(axis=0)
    x_std = X.std(axis=0) + 1e-6
    y_mean = Y.mean(axis=0)
    y_std = Y.std(axis=0) + 1e-6

    X_norm = (X - x_mean) / x_std
    Y_norm = (Y - y_mean) / y_std

    torch.manual_seed(42)
    model = PlayerStatMLP(X.shape[1], Y.shape[1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.004, weight_decay=1e-4)
    criterion = nn.HuberLoss()

    x_tensor = torch.from_numpy(X_norm)
    y_tensor = torch.from_numpy(Y_norm)

    model.train()
    batch_size = min(64, len(X))
    for _ in range(epochs):
        perm = torch.randperm(len(X))
        for i in range(0, len(X), batch_size):
            idx = perm[i : i + batch_size]
            optimizer.zero_grad()
            pred = model(x_tensor[idx])
            loss = criterion(pred, y_tensor[idx])
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        final_loss = float(criterion(model(x_tensor), y_tensor).item())

    role_name = "Pitcher" if is_pitcher else "Batter"
    print(f" -> [PyTorch DL] {role_name} MLP 학습 완료 (표본: {len(X)}건, HuberLoss: {final_loss:.4f})")

    return {
        "state_dict": model.state_dict(),
        "x_mean": x_mean,
        "x_std": x_std,
        "y_mean": y_mean,
        "y_std": y_std,
        "sample_count": len(X),
        "loss": round(final_loss, 4),
    }


def train_and_save_dl_models() -> dict[str, Any]:
    print("========================================================")
    print("[PyTorch DL] 타자 · 투수 성적 예측 신경망(MLP) 학습 시작")
    print("========================================================")
    batter_bundle = _train_single_role_mlp(is_pitcher=False)
    pitcher_bundle = _train_single_role_mlp(is_pitcher=True)

    checkpoint = {
        "batter": batter_bundle,
        "pitcher": pitcher_bundle,
        "trained_at": str(date.today()),
    }
    torch.save(checkpoint, MODEL_PT_PATH)
    print(f">>> PyTorch DL 가중치 저장 완료: {MODEL_PT_PATH}")
    return checkpoint


# ---------------------------------------------------------
# 5. 추론 및 시뮬레이션 서비스 클래스
# ---------------------------------------------------------
class PlayerDLPredictor:
    def __init__(self):
        self.checkpoint = None
        self.batter_model: Optional[PlayerStatMLP] = None
        self.pitcher_model: Optional[PlayerStatMLP] = None
        self._ensure_loaded()

    def _ensure_loaded(self):
        if not MODEL_PT_PATH.exists():
            try:
                self.checkpoint = train_and_save_dl_models()
            except Exception as e:
                print(f"[PlayerDLPredictor] 초기 학습 실패: {e}")
                return
        else:
            try:
                self.checkpoint = torch.load(MODEL_PT_PATH, map_location="cpu", weights_only=False)
            except Exception:
                self.checkpoint = train_and_save_dl_models()

        if self.checkpoint:
            self.batter_model = PlayerStatMLP(len(BATTER_FEATURES), len(BATTER_TARGETS))
            self.batter_model.load_state_dict(self.checkpoint["batter"]["state_dict"])
            self.batter_model.eval()

            self.pitcher_model = PlayerStatMLP(len(PITCHER_FEATURES), len(PITCHER_TARGETS))
            self.pitcher_model.load_state_dict(self.checkpoint["pitcher"]["state_dict"])
            self.pitcher_model.eval()

    def predict_player_season(
        self,
        db: Session,
        player_id: int,
        target_season: int = 2027,
        mode: Optional[str] = None,
        scenario: str = "normal",  # 'full'(풀타임), 'normal'(평균유지), 'conservative'(보수적/에이징)
    ) -> dict[str, Any]:
        self._ensure_loaded()

        p_row = db.execute(
            text("""
                SELECT p.player_id, p.player_name, p.position, p.birth_date, t.team_name, t.team_code
                FROM players p
                LEFT JOIN teams t ON p.team_id = t.team_id
                WHERE p.player_id = :pid
            """),
            {"pid": player_id},
        ).mappings().first()

        if not p_row:
            raise ValueError("해당 선수를 찾을 수 없습니다.")

        # 선수의 전체 시즌 기록 로드
        all_rows = db.execute(
            text("""
                SELECT * FROM player_season_stats
                WHERE player_id = :pid AND games > 0
                ORDER BY season DESC
            """),
            {"pid": player_id},
        ).mappings().all()

        if not all_rows:
            raise ValueError("예측에 사용할 시즌 기록이 없습니다.")

        pos_str = str(p_row["position"] or "").upper()
        if mode in ("batting", "pitching"):
            is_pitcher = mode == "pitching"
        else:
            has_pit = any(bool(r["is_pitcher"]) for r in all_rows)
            has_bat = any(not bool(r["is_pitcher"]) for r in all_rows)
            is_pitcher = True if ("P" in pos_str and has_pit) or (has_pit and not has_bat) else False

        role_rows = [
            (_enrich_slash_line(dict(r)) if not is_pitcher else dict(r))
            for r in all_rows
            if bool(r["is_pitcher"]) == is_pitcher
        ]
        if not role_rows:
            role_rows = [_enrich_slash_line(dict(r)) for r in all_rows]
            is_pitcher = bool(role_rows[0].get("is_pitcher"))

        # target_season 이전 시즌들의 기록만 입력으로 사용 (과거 연도 선택 시 백테스트 지원!)
        prior_rows = [r for r in role_rows if int(r["season"]) < int(target_season)]
        if not prior_rows:
            # 가장 오래된 시즌보다 이전을 고른 경우 최신 기록 사용
            prior_rows = role_rows[:3]
        else:
            prior_rows = prior_rows[:3]

        # 만약 선택한 target_season의 실제 기록이 DB에 존재한다면 백테스트 비교용으로 추출
        actual_season_row = next((r for r in role_rows if int(r["season"]) == int(target_season)), None)
        baseline_row = prior_rows[0]  # 직전 시즌 기록 (증감 비교 기준)

        feature_cols = PITCHER_FEATURES if is_pitcher else BATTER_FEATURES
        target_cols = PITCHER_TARGETS if is_pitcher else BATTER_TARGETS
        defaults = PITCHER_DEFAULTS if is_pitcher else BATTER_DEFAULTS
        bundle = self.checkpoint["pitcher" if is_pitcher else "batter"]
        model = self.pitcher_model if is_pitcher else self.batter_model

        x_vec = _weighted_prev_features(
            prior_rows, feature_cols, defaults, int(target_season), p_row.get("birth_date")
        )
        # 여러 해 미래(예: 2027, 2028)를 예측할 때 나이 변화가 확실히 반영되도록 설정
        pred_age = _calc_age_at_season(p_row.get("birth_date"), int(target_season))
        x_vec[0] = pred_age

        x_norm = (x_vec - bundle["x_mean"]) / bundle["x_std"]
        with torch.no_grad():
            y_norm = model(torch.from_numpy(x_norm).unsqueeze(0)).squeeze(0).numpy()
        raw_pred = y_norm * bundle["y_std"] + bundle["y_mean"]
        dl_map = {col: float(val) for col, val in zip(target_cols, raw_pred)}

        # 신경망 출력값 + 세이버메트릭스 기대지표(xStats) 기반 도메인 앙상블 및 시나리오 보정
        latest_season = int(baseline_row["season"])
        year_gap = max(1, int(target_season) - latest_season)
        aging_curve = 1.0 - max(0.0, (pred_age - 30.0) * 0.014 * year_gap) + max(0.0, (26.0 - pred_age) * 0.008)

        playtime_mult = {"full": 1.18, "normal": 1.0, "conservative": 0.82}.get(scenario, 1.0)
        rate_bonus = {"full": 1.02, "normal": 1.0, "conservative": 0.97}.get(scenario, 1.0)

        predicted_stats: dict[str, Any] = {}
        comparison_deltas: dict[str, Any] = {}
        insights: list[str] = []

        if not is_pitcher:
            base_avg = float(baseline_row.get("batting_avg") or 0.248)
            base_xba = float(baseline_row.get("xba") or base_avg)
            base_slg = float(baseline_row.get("slg") or 0.410)
            base_xslg = float(baseline_row.get("xslg") or base_slg)
            base_obp = float(baseline_row.get("obp") or 0.315)

            pred_avg = round(max(0.180, min(0.350, (0.45 * dl_map["batting_avg"] + 0.35 * base_xba + 0.20 * base_avg) * aging_curve * rate_bonus)), 3)
            pred_obp = round(max(pred_avg + 0.035, min(0.460, (0.50 * dl_map["obp"] + 0.50 * base_obp) * aging_curve * rate_bonus)), 3)
            pred_slg = round(max(0.280, min(0.690, (0.45 * dl_map["slg"] + 0.35 * base_xslg + 0.20 * base_slg) * aging_curve * rate_bonus)), 3)
            pred_ops = round(pred_obp + pred_slg, 3)

            avg_games = sum(float(r.get("games") or 110) for r in prior_rows) / len(prior_rows)
            pred_games = int(round(max(40, min(162, (152 if scenario == "full" else avg_games * playtime_mult)))))
            game_scale = pred_games / max(50.0, avg_games)

            pred_hr = int(round(max(0, min(65, (0.55 * dl_map["home_runs"] + 0.45 * float(baseline_row.get("home_runs") or 12)) * game_scale * aging_curve))))
            pred_rbi = int(round(max(5, min(155, (0.55 * dl_map["rbi"] + 0.45 * float(baseline_row.get("rbi") or 50)) * game_scale * aging_curve))))
            pred_sb = int(round(max(0, min(80, (0.55 * dl_map["stolen_bases"] + 0.45 * float(baseline_row.get("stolen_bases") or 5)) * game_scale * (aging_curve ** 1.3)))))
            pred_wrc = int(round(max(50, min(220, ((pred_ops / 0.720) * 100 * 0.6 + dl_map["wrc_plus"] * 0.4)))))
            pred_fwar = round(max(-1.0, min(11.5, ((pred_wrc - 100) * (pred_games / 150.0) * 0.045 + (pred_games / 150.0) * 1.8))), 1)
            pred_bwar = round(max(-1.0, min(11.5, pred_fwar * 0.95)), 1)

            predicted_stats = {
                "games": pred_games,
                "batting_avg": pred_avg,
                "obp": pred_obp,
                "slg": pred_slg,
                "ops": pred_ops,
                "home_runs": pred_hr,
                "rbi": pred_rbi,
                "stolen_bases": pred_sb,
                "wrc_plus": pred_wrc,
                "bwar": pred_bwar,
                "fwar": pred_fwar,
            }

            if base_xba - base_avg >= 0.015:
                insights.append(f"직전 시즌 기대타율(xBA {base_xba:.3f})이 실제 타율({base_avg:.3f})보다 높아 BABIP 운이 정상화되면서 타율 반등이 예상됩니다.")
            elif base_avg - base_xba >= 0.020:
                insights.append(f"직전 시즌 실제 타율({base_avg:.3f})이 기대타율(xBA {base_xba:.3f})을 상회하여 소폭 평균 회귀 가능성이 반영되었습니다.")

            if float(baseline_row.get("barrel_percentage") or 0) >= 12.0 or float(baseline_row.get("bat_speed") or 0) >= 74.0:
                insights.append(f"최상위권의 배트 스피드({baseline_row.get('bat_speed') or '-'} mph)와 배럴 타구 비율({baseline_row.get('barrel_percentage') or '-'}%)을 보유해 장타 생산력이 안정적으로 유지될 전망입니다.")
        else:
            base_era = float(baseline_row.get("era") or 4.15)
            base_xera = float(baseline_row.get("xera") or baseline_row.get("fip") or base_era)
            base_fip = float(baseline_row.get("fip") or 4.12)
            base_whip = float(baseline_row.get("whip") or 1.28)

            inv_aging = 2.0 - aging_curve  # 투수 ERA/FIP는 나이가 들수록 소폭 상승
            era_scen = {"full": 0.96, "normal": 1.0, "conservative": 1.05}.get(scenario, 1.0)

            pred_era = round(max(1.65, min(6.50, (0.40 * dl_map["era"] + 0.40 * base_xera + 0.20 * base_era) * inv_aging * era_scen)), 2)
            pred_fip = round(max(1.80, min(6.20, (0.50 * dl_map["fip"] + 0.50 * base_fip) * inv_aging * era_scen)), 2)
            pred_whip = round(max(0.82, min(1.75, (0.50 * dl_map["whip"] + 0.50 * base_whip) * inv_aging * era_scen)), 2)

            avg_ip = sum(float(r.get("innings_pitched") or 70.0) for r in prior_rows) / len(prior_rows)
            is_starter = avg_ip >= 85.0
            target_ip = (185.0 if is_starter else 68.0) if scenario == "full" else (avg_ip * playtime_mult)
            pred_ip = round(max(20.0, min(225.0, target_ip)), 1)
            ip_scale = pred_ip / max(30.0, avg_ip)

            avg_g = sum(float(r.get("games") or 28) for r in prior_rows) / len(prior_rows)
            pred_games = int(round(max(10, min(80, (32 if is_starter and scenario == "full" else avg_g * playtime_mult)))))
            pred_so = int(round(max(15, min(300, (0.50 * dl_map["strikeouts"] + 0.50 * float(baseline_row.get("strikeouts") or 70)) * ip_scale * aging_curve))))
            pred_w = int(round(max(1, min(24, (0.50 * dl_map["wins"] + 0.50 * float(baseline_row.get("wins") or 6)) * ip_scale))))
            pred_l = int(round(max(1, min(18, (0.50 * dl_map["losses"] + 0.50 * float(baseline_row.get("losses") or 6)) * ip_scale))))
            pred_fwar = round(max(-1.0, min(9.5, ((4.25 - pred_fip) / 9.0 * pred_ip / 9.5) + (pred_ip / 180.0 * 0.8))), 1)
            pred_bwar = round(max(-1.0, min(9.5, ((4.25 - pred_era) / 9.0 * pred_ip / 9.5) + (pred_ip / 180.0 * 0.8))), 1)

            predicted_stats = {
                "games": pred_games,
                "innings_pitched": pred_ip,
                "wins": pred_w,
                "losses": pred_l,
                "era": pred_era,
                "fip": pred_fip,
                "whip": pred_whip,
                "strikeouts": pred_so,
                "bwar": pred_bwar,
                "fwar": pred_fwar,
            }

            if base_era - base_xera >= 0.35:
                insights.append(f"직전 시즌 기대 평균자책점(xERA {base_xera:.2f})이 실제 ERA({base_era:.2f})보다 훨씬 우수하여 다음 시즌 평균자책점 개선 가능성이 높습니다.")
            elif base_xera - base_era >= 0.40:
                insights.append(f"직전 시즌 실제 ERA({base_era:.2f})가 기대 지표(xERA {base_xera:.2f}) 대비 낮게 형성되어 소폭 조정 가능성이 반영되었습니다.")

            if float(baseline_row.get("whiff_percentage") or 0) >= 28.0:
                insights.append(f"뛰어난 헛스윙 유도율(Whiff% {baseline_row.get('whiff_percentage')}%)과 구위를 바탕으로 높은 탈삼진 능력이 유지될 것으로 분석됩니다.")

        if pred_age >= 34:
            insights.append(f"{target_season} 시즌 기준 만 {int(pred_age)}세 시즌으로, 에이징 커브에 따른 체력 및 에이징 가중치가 모델에 반영되었습니다.")
        elif pred_age <= 26:
            insights.append(f"{target_season} 시즌 기준 만 {int(pred_age)}세로 전성기 진입 구간에 해당하여 성장 잠재력 가중치가 반영되었습니다.")

        if not insights:
            insights.append(f"최근 {len(prior_rows)}개 시즌의 Statcast 타구질·구위 지표와 실제 성적의 일관성이 높아 안정적인 성적 유지가 예상됩니다.")

        # 직전 시즌(baseline) 대비 증감량(delta) 계산
        for k, v in predicted_stats.items():
            prev_v = baseline_row.get(k)
            if prev_v is not None and not pd.isna(prev_v):
                diff = round(float(v) - float(prev_v), 3 if k in ("batting_avg", "obp", "slg", "ops") else (2 if k in ("era", "fip", "whip") else 1))
                comparison_deltas[k] = diff
            else:
                comparison_deltas[k] = 0

        actual_stats = None
        if actual_season_row:
            actual_stats = {k: actual_season_row.get(k) for k in predicted_stats.keys()}

        return {
            "player_id": int(p_row["player_id"]),
            "player_name": p_row["player_name"],
            "team_name": p_row["team_name"] or "FA",
            "team_code": p_row["team_code"] or "MLB",
            "position": p_row["position"] or "-",
            "mode": "pitching" if is_pitcher else "batting",
            "target_season": int(target_season),
            "predicted_age": int(pred_age),
            "scenario": scenario,
            "baseline_season": int(baseline_row["season"]),
            "prior_seasons_used": [int(r["season"]) for r in prior_rows],
            "predicted": predicted_stats,
            "baseline": {k: baseline_row.get(k) for k in predicted_stats.keys()},
            "deltas": comparison_deltas,
            "actual": actual_stats,  # 과거 시즌 선택 시 실제 성적과 백테스트 비교용!
            "insights": insights,
            "model_info": {
                "architecture": "PyTorch Multi-Output MLP (64-32 GELU + LayerNorm)",
                "features_count": len(feature_cols),
                "sample_count": bundle.get("sample_count", 0),
            },
        }


dl_predictor = PlayerDLPredictor()


# ---------------------------------------------------------
# 6. AI 챗봇 연동 헬퍼 (질문에서 선수 & 목표 연도 추출 후 텍스트 리포트 반환)
# ---------------------------------------------------------
def find_player_for_chat(db: Session, question: str) -> Optional[dict[str, Any]]:
    q_low = question.strip().casefold()

    # 1) 한글 별칭 매칭 우선 확인
    for kor_name, eng_name in sorted(KOR_PLAYER_ALIASES.items(), key=lambda x: len(x[0]), reverse=True):
        if kor_name in q_low:
            row = db.execute(
                text("SELECT player_id, player_name, position FROM players WHERE LOWER(player_name) LIKE :ename LIMIT 1"),
                {"ename": f"%{eng_name.lower()}%"},
            ).mappings().first()
            if row:
                return dict(row)

    # 2) DB 영문 전체 이름 또는 성(Last Name) 매칭
    rows = db.execute(
        text("SELECT player_id, player_name, position FROM players ORDER BY CHAR_LENGTH(player_name) DESC")
    ).mappings().all()

    for r in rows:
        pname = str(r["player_name"] or "").casefold()
        if pname and pname in q_low:
            return dict(r)

    # 성(Last name, 4글자 이상) 단독 매칭
    for r in rows:
        parts = str(r["player_name"] or "").casefold().split()
        if len(parts) >= 2 and len(parts[-1]) >= 4 and parts[-1] in q_low:
            return dict(r)

    return None


def get_dl_prediction_chat_context(db: Session, question: str) -> Optional[str]:
    """챗봇 질문이 선수 성적 예측 요청일 경우 PyTorch DL 예측 결과를 텍스트 컨텍스트로 생성"""
    player = find_player_for_chat(db, question)
    if not player:
        return None

    # 질문에서 연도 추출 (예: 2025년, 2026, 2027시즌, 내년, 올해)
    yr_match = re.search(r"(202[4-9]|2030)\s*(?:년|시즌)?", question)
    if yr_match:
        target_season = int(yr_match.group(1))
    elif "내년" in question or "다음 시즌" in question:
        target_season = date.today().year + 1
    else:
        # DB 최신 시즌의 다음 시즌을 기본 예측 연도로 설정
        max_s = db.execute(
            text("SELECT MAX(season) FROM player_season_stats WHERE player_id = :pid"),
            {"pid": player["player_id"]},
        ).scalar()
        target_season = int(max_s or 2025) + 1

    scenario = "full" if ("풀타임" in question or "최고" in question) else "normal"

    try:
        res = dl_predictor.predict_player_season(
            db=db,
            player_id=int(player["player_id"]),
            target_season=target_season,
            scenario=scenario,
        )
    except Exception as e:
        print(f"[챗봇 DL 선수 예측 오류] {e}")
        return None

    p = res["predicted"]
    b = res["baseline"]
    actual = res.get("actual")

    lines = [
        f"[BASEBOT PyTorch 딥러닝(DL) 선수 성적 예측 결과]",
        f"선수명: {res['player_name']} ({res['team_name']}, 포지션: {res['position']})",
        f"예측 대상 시즌: {res['target_season']} 시즌 (만 {res['predicted_age']}세 기준)",
        f"분석 기반 시즌: {', '.join(map(str, res['prior_seasons_used']))} 시즌 세이버메트릭스 데이터",
        f"적용 모델: {res['model_info']['architecture']}",
    ]

    if res["mode"] == "batting":
        lines.extend([
            f"예상 출전 경기: {p['games']}경기 (직전 {res['baseline_season']}시즌: {b.get('games')}경기)",
            f"예상 타율 / 출루율 / 장타율 / OPS: {p['batting_avg']:.3f} / {p['obp']:.3f} / {p['slg']:.3f} / {p['ops']:.3f}",
            f"직전 시즌({res['baseline_season']}) 타율 / OPS: {b.get('batting_avg')} / {b.get('ops')}",
            f"예상 홈런 / 타점 / 도루: {p['home_runs']}홈런 / {p['rbi']}타점 / {p['stolen_bases']}도루",
            f"예상 wRC+ / bWAR / fWAR: wRC+ {p['wrc_plus']} / bWAR {p['bwar']} / fWAR {p['fwar']}",
        ])
        if actual:
            lines.append(
                f"참고(실제 {res['target_season']}시즌 기록): {actual.get('games')}경기, 타율 {actual.get('batting_avg')}, "
                f"{actual.get('home_runs')}홈런, {actual.get('rbi')}타점, wRC+ {actual.get('wrc_plus')}, fWAR {actual.get('fwar')}"
            )
    else:
        lines.extend([
            f"예상 등판 / 이닝: {p['games']}경기 / {p['innings_pitched']}이닝 (직전 {res['baseline_season']}시즌: {b.get('innings_pitched')}이닝)",
            f"예상 평균자책점(ERA) / FIP / WHIP: ERA {p['era']:.2f} / FIP {p['fip']:.2f} / WHIP {p['whip']:.2f}",
            f"직전 시즌({res['baseline_season']}) ERA / FIP: ERA {b.get('era')} / FIP {b.get('fip')}",
            f"예상 승-패 / 탈삼진: {p['wins']}승 {p['losses']}패 / {p['strikeouts']}탈삼진",
            f"예상 bWAR / fWAR: bWAR {p['bwar']} / fWAR {p['fwar']}",
        ])
        if actual:
            lines.append(
                f"참고(실제 {res['target_season']}시즌 기록): {actual.get('games')}경기 {actual.get('innings_pitched')}이닝, "
                f"{actual.get('wins')}승 {actual.get('losses')}패, ERA {actual.get('era')}, {actual.get('strikeouts')}탈삼진, fWAR {actual.get('fwar')}"
            )

    lines.append("딥러닝 스카우팅 분석 요약:")
    for ins in res["insights"]:
        lines.append(f"- {ins}")

    return "\n".join(lines)


if __name__ == "__main__":
    train_and_save_dl_models()