import joblib
import pandas as pd
from pathlib import Path
from typing import Optional
from sqlalchemy import text
from database.db_connection import engine
from ml.train_prediction_model import (
    MODEL_PATH,
    FEATURE_COLS,
    build_team_metrics,
    get_safe_stat,
    compute_feature_diff_dict,
)


class MatchupPredictor:
    def __init__(self):
        self.model = None
        self.model_features = FEATURE_COLS
        self._load_model()

    def _load_model(self):
        if MODEL_PATH.exists():
            try:
                bundle = joblib.load(MODEL_PATH)
                if isinstance(bundle, dict):
                    self.model = bundle.get("model")
                    self.model_features = bundle.get("features", FEATURE_COLS)
                else:
                    self.model = bundle
            except Exception as e:
                print(f"[Predictor] 모델 로드 실패 (휴리스틱 모드로 대체): {e}")

    def _resolve_target_season(self, conn, requested_season: Optional[int] = None) -> int:
        seasons = conn.execute(
            text("SELECT DISTINCT season FROM player_season_stats WHERE season IS NOT NULL AND games > 0 ORDER BY season DESC")
        ).scalars().all()
        avail = [int(s) for s in seasons if s is not None] or [2024]
        if requested_season and int(requested_season) in avail:
            return int(requested_season)
        return avail[0]

    def predict_matchup(self, home_team_id: int, away_team_id: int, season: Optional[int] = None) -> dict:
        with engine.connect() as conn:
            target_season = self._resolve_target_season(conn, season)
            team_metrics = build_team_metrics(conn, season=target_season)

            # 맞대결 상대전적 조회 (해당 시즌 우선, 없으면 전체 기간)
            h2h_rows = conn.execute(text("""
                SELECT home_team_id, away_team_id, home_score, away_score
                FROM games
                WHERE status = 'FINAL'
                  AND YEAR(game_date) = :season
                  AND ((home_team_id = :hid AND away_team_id = :aid)
                    OR (home_team_id = :aid AND away_team_id = :hid))
            """), {"season": target_season, "hid": home_team_id, "aid": away_team_id}).mappings().all()

            if not h2h_rows:
                h2h_rows = conn.execute(text("""
                    SELECT home_team_id, away_team_id, home_score, away_score
                    FROM games
                    WHERE status = 'FINAL'
                      AND ((home_team_id = :hid AND away_team_id = :aid)
                        OR (home_team_id = :aid AND away_team_id = :hid))
                """), {"hid": home_team_id, "aid": away_team_id}).mappings().all()

        h_wins, a_wins = 0, 0
        for g in h2h_rows:
            if g["home_score"] > g["away_score"]:
                if int(g["home_team_id"]) == int(home_team_id):
                    h_wins += 1
                else:
                    a_wins += 1
            elif g["away_score"] > g["home_score"]:
                if int(g["away_team_id"]) == int(home_team_id):
                    h_wins += 1
                else:
                    a_wins += 1

        if (h_wins + a_wins) > 0:
            h2h_summary = f"상대전적: 원정팀 {a_wins}승 vs 홈팀 {h_wins}승"
        else:
            h2h_summary = "맞대결 전적 데이터 없음"

        h_stat = team_metrics.loc[home_team_id] if home_team_id in team_metrics.index else None
        a_stat = team_metrics.loc[away_team_id] if away_team_id in team_metrics.index else None

        diff_dict = compute_feature_diff_dict(h_stat, a_stat)

        # 1. ML 모델 기반 기본 승률 산출
        ml_home_prob = 0.52
        if self.model is not None:
            try:
                X_input = pd.DataFrame([{col: diff_dict.get(col, 0.0) for col in self.model_features}])
                ml_home_prob = float(self.model.predict_proba(X_input)[0][1])
            except Exception as e:
                print(f"[Predictor] ML 추론 예외: {e}")

        # 2. 세이버메트릭스 종합 파워 스코어 (신규 지표: 배트스피드, 구종가치, 수비가치, 프레이밍 등 반영)
        saber_score = (
            diff_dict["diff_wrc_plus"] * 0.0025
            + diff_dict["diff_batting_rv"] * 0.0008
            + diff_dict["diff_xwoba"] * 1.2
            + diff_dict["diff_bat_speed"] * 0.008
            + diff_dict["diff_pitching_rv"] * 0.0008
            + (diff_dict["diff_fb_rv"] + diff_dict["diff_brk_rv"] + diff_dict["diff_off_rv"]) * 0.0005
            - diff_dict["diff_fip"] * 0.045
            - diff_dict["diff_xera"] * 0.045
            + diff_dict["diff_fielding_rv"] * 0.0012
            + diff_dict["diff_framing_runs"] * 0.0010
            + diff_dict["diff_bsr_rv"] * 0.0010
            + diff_dict["diff_avg_bwar"] * 0.05
        )
        heuristic_home_prob = max(0.20, min(0.80, 0.515 + saber_score))

        # ML 모델 확률(70%) + 세이버메트릭스 정밀 보정(30%) 블렌딩
        final_home_prob = round((ml_home_prob * 0.7 + heuristic_home_prob * 0.3) * 100, 1)
        final_home_prob = max(15.0, min(85.0, final_home_prob))
        final_away_prob = round(100.0 - final_home_prob, 1)

        predicted_winner_id = home_team_id if final_home_prob >= final_away_prob else away_team_id

        # 3. 프론트엔드 비교 테이블용 전체 지표 딕셔너리 (Extension 제외 전 지표)
        metrics_comparison = {
            "season": target_season,
            # 타격 & 배트 트래킹
            "away_wrc_plus": int(round(get_safe_stat(a_stat, "wrc_plus"))),
            "home_wrc_plus": int(round(get_safe_stat(h_stat, "wrc_plus"))),
            "away_batting_rv": int(round(get_safe_stat(a_stat, "batting_rv"))),
            "home_batting_rv": int(round(get_safe_stat(h_stat, "batting_rv"))),
            "away_xwoba": round(get_safe_stat(a_stat, "xwoba"), 3),
            "home_xwoba": round(get_safe_stat(h_stat, "xwoba"), 3),
            "away_xba": round(get_safe_stat(a_stat, "xba"), 3),
            "home_xba": round(get_safe_stat(h_stat, "xba"), 3),
            "away_xslg": round(get_safe_stat(a_stat, "xslg"), 3),
            "home_xslg": round(get_safe_stat(h_stat, "xslg"), 3),
            "away_bat_speed": round(get_safe_stat(a_stat, "bat_speed"), 1),
            "home_bat_speed": round(get_safe_stat(h_stat, "bat_speed"), 1),
            "away_squared_up_pct": round(get_safe_stat(a_stat, "squared_up_pct"), 1),
            "home_squared_up_pct": round(get_safe_stat(h_stat, "squared_up_pct"), 1),
            "away_avg_exit_velo": round(get_safe_stat(a_stat, "avg_exit_velo"), 1),
            "home_avg_exit_velo": round(get_safe_stat(h_stat, "avg_exit_velo"), 1),
            "away_barrel_pct": round(get_safe_stat(a_stat, "barrel_pct"), 1),
            "home_barrel_pct": round(get_safe_stat(h_stat, "barrel_pct"), 1),
            "away_hard_hit_pct": round(get_safe_stat(a_stat, "hard_hit_pct"), 1),
            "home_hard_hit_pct": round(get_safe_stat(h_stat, "hard_hit_pct"), 1),
            # 마운드 & 구종 가치 (Extension 제외)
            "away_pitching_rv": int(round(get_safe_stat(a_stat, "pitching_rv"))),
            "home_pitching_rv": int(round(get_safe_stat(h_stat, "pitching_rv"))),
            "away_fb_rv": int(round(get_safe_stat(a_stat, "fb_rv"))),
            "home_fb_rv": int(round(get_safe_stat(h_stat, "fb_rv"))),
            "away_brk_rv": int(round(get_safe_stat(a_stat, "brk_rv"))),
            "home_brk_rv": int(round(get_safe_stat(h_stat, "brk_rv"))),
            "away_off_rv": int(round(get_safe_stat(a_stat, "off_rv"))),
            "home_off_rv": int(round(get_safe_stat(h_stat, "off_rv"))),
            "away_fip": round(get_safe_stat(a_stat, "fip"), 2),
            "home_fip": round(get_safe_stat(h_stat, "fip"), 2),
            "away_xera": round(get_safe_stat(a_stat, "xera"), 2),
            "home_xera": round(get_safe_stat(h_stat, "xera"), 2),
            "away_era": round(get_safe_stat(a_stat, "era"), 2),
            "home_era": round(get_safe_stat(h_stat, "era"), 2),
            "away_pit_xba": round(get_safe_stat(a_stat, "pit_xba"), 3),
            "home_pit_xba": round(get_safe_stat(h_stat, "pit_xba"), 3),
            "away_fastball_velo": round(get_safe_stat(a_stat, "fastball_velo"), 1),
            "home_fastball_velo": round(get_safe_stat(h_stat, "fastball_velo"), 1),
            "away_pit_k_pct": round(get_safe_stat(a_stat, "pit_k_pct"), 1),
            "home_pit_k_pct": round(get_safe_stat(h_stat, "pit_k_pct"), 1),
            "away_pit_whiff_pct": round(get_safe_stat(a_stat, "pit_whiff_pct"), 1),
            "home_pit_whiff_pct": round(get_safe_stat(h_stat, "pit_whiff_pct"), 1),
            "away_pit_gb_pct": round(get_safe_stat(a_stat, "pit_gb_pct"), 1),
            "home_pit_gb_pct": round(get_safe_stat(h_stat, "pit_gb_pct"), 1),
            # 수비 · 포수 프레이밍 · 주루 · WAR
            "away_fielding_rv": int(round(get_safe_stat(a_stat, "fielding_rv"))),
            "home_fielding_rv": int(round(get_safe_stat(h_stat, "fielding_rv"))),
            "away_team_oaa": int(round(get_safe_stat(a_stat, "team_oaa"))),
            "home_team_oaa": int(round(get_safe_stat(h_stat, "team_oaa"))),
            "away_arm_value": int(round(get_safe_stat(a_stat, "arm_value"))),
            "home_arm_value": int(round(get_safe_stat(h_stat, "arm_value"))),
            "away_framing_runs": int(round(get_safe_stat(a_stat, "framing_runs"))),
            "home_framing_runs": int(round(get_safe_stat(h_stat, "framing_runs"))),
            "away_bsr_rv": int(round(get_safe_stat(a_stat, "bsr_rv"))),
            "home_bsr_rv": int(round(get_safe_stat(h_stat, "bsr_rv"))),
            "away_sprint_speed": round(get_safe_stat(a_stat, "sprint_speed"), 1),
            "home_sprint_speed": round(get_safe_stat(h_stat, "sprint_speed"), 1),
            "away_avg_bwar": round(get_safe_stat(a_stat, "avg_bwar"), 2),
            "home_avg_bwar": round(get_safe_stat(h_stat, "avg_bwar"), 2),
        }

        return {
            "season": target_season,
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "home_win_prob": final_home_prob,
            "away_win_prob": final_away_prob,
            "predicted_winner_id": predicted_winner_id,
            "head_to_head_summary": h2h_summary,
            "metrics_comparison": metrics_comparison
        }


predictor = MatchupPredictor()