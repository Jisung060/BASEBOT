import os
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sqlalchemy import text
from database.db_connection import engine

MODEL_PATH = Path(__file__).resolve().parent.parent / "ml" / "game_prediction_model.pkl"

class GamePredictor:
    def __init__(self):
        self.model_data = None
        self.load_model()

    def load_model(self):
        if os.path.exists(MODEL_PATH):
            self.model_data = joblib.load(MODEL_PATH)
        else:
            self.model_data = None

    def get_head_to_head_record(self, conn, team_a_id: int, team_b_id: int):
        """두 팀 간의 2024 시즌 맞대결 전적 집계 (FINAL 경기 기준)"""
        h2h_query = text("""
            SELECT 
                home_team_id,
                away_team_id,
                home_score,
                away_score
            FROM games
            WHERE status = 'FINAL'
              AND (
                  (home_team_id = :team_a AND away_team_id = :team_b) OR
                  (home_team_id = :team_b AND away_team_id = :team_a)
              )
        """)
        matches = conn.execute(h2h_query, {"team_a": team_a_id, "team_b": team_b_id}).mappings().all()

        total_games = len(matches)
        team_a_wins = 0
        team_b_wins = 0
        team_a_runs = 0
        team_b_runs = 0

        for m in matches:
            h_id = m["home_team_id"]
            h_score = m["home_score"]
            a_score = m["away_score"]

            if h_id == team_a_id:
                team_a_runs += h_score
                team_b_runs += a_score
                if h_score > a_score:
                    team_a_wins += 1
                elif a_score > h_score:
                    team_b_wins += 1
            else:
                team_b_runs += h_score
                team_a_runs += a_score
                if h_score > a_score:
                    team_b_wins += 1
                elif a_score > h_score:
                    team_a_wins += 1

        return {
            "total_games": total_games,
            "home_team_wins": team_a_wins,  # 파라미터 첫 번째 팀(홈팀) 기준 승수
            "away_team_wins": team_b_wins,  # 파라미터 두 번째 팀(원정팀) 기준 승수
            "home_team_runs": team_a_runs,
            "away_team_runs": team_b_runs
        }

    def predict_matchup(self, home_team_id: int, away_team_id: int):
        if not self.model_data:
            self.load_model()
            if not self.model_data:
                raise FileNotFoundError("학습된 예측 모델(.pkl)이 존재하지 않습니다. train_prediction_model.py를 먼저 실행해 주세요.")

        model = self.model_data["model"]

        with engine.connect() as conn:
            # 1. 팀별 세이버메트릭스 지표 조회
            query = text("""
                SELECT 
                    p.team_id,
                    AVG(s.bwar) AS avg_bwar,
                    AVG(s.avg_exit_velocity) AS team_exit_velo,
                    AVG(s.barrel_percentage) AS team_barrel_pct,
                    AVG(s.batting_avg) AS team_batting_avg
                FROM players p
                JOIN player_season_stats s ON p.player_id = s.player_id
                WHERE p.team_id IN (:home_id, :away_id) AND s.season = 2024
                GROUP BY p.team_id
            """)
            rows = conn.execute(query, {"home_id": home_team_id, "away_id": away_team_id}).mappings().all()

            # 2. 상대전적 조회
            h2h = self.get_head_to_head_record(conn, home_team_id, away_team_id)

        stats_map = {r["team_id"]: r for r in rows}
        h_stat = stats_map.get(home_team_id)
        a_stat = stats_map.get(away_team_id)

        h_bwar = float(h_stat["avg_bwar"]) if h_stat and h_stat["avg_bwar"] else 0.0
        a_bwar = float(a_stat["avg_bwar"]) if a_stat and a_stat["avg_bwar"] else 0.0

        h_velo = float(h_stat["team_exit_velo"]) if h_stat and h_stat["team_exit_velo"] else 88.0
        a_velo = float(a_stat["team_exit_velo"]) if a_stat and a_stat["team_exit_velo"] else 88.0

        h_barrel = float(h_stat["team_barrel_pct"]) if h_stat and h_stat["team_barrel_pct"] else 6.0
        a_barrel = float(a_stat["team_barrel_pct"]) if a_stat and a_stat["team_barrel_pct"] else 6.0

        h_ba = float(h_stat["team_batting_avg"]) if h_stat and h_stat["team_batting_avg"] else 0.240
        a_ba = float(a_stat["team_batting_avg"]) if a_stat and a_stat["team_batting_avg"] else 0.240

        # 피처 벡터 구성
        features = pd.DataFrame([{
            "diff_avg_bwar": h_bwar - a_bwar,
            "diff_exit_velo": h_velo - a_velo,
            "diff_barrel_pct": h_barrel - a_barrel,
            "diff_batting_avg": h_ba - a_ba
        }])

        prob_home_win = float(model.predict_proba(features)[0][1])
        prob_away_win = float(1.0 - prob_home_win)

        predicted_winner_id = home_team_id if prob_home_win >= 0.5 else away_team_id

        # 사용자 친화적 예측 코멘트 생성
        if h2h["total_games"] > 0:
            h2h_summary = f"올 시즌 상대전적: {h2h['home_team_wins']}승 {h2h['away_team_wins']}패"
        else:
            h2h_summary = "올 시즌 맞대결 기록 없음"

        return {
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "home_win_prob": round(prob_home_win * 100, 1),
            "away_win_prob": round(prob_away_win * 100, 1),
            "predicted_winner_id": predicted_winner_id,
            "head_to_head": h2h,
            "head_to_head_summary": h2h_summary,
            "metrics_comparison": {
                "home_avg_exit_velo": round(h_velo, 1),
                "away_avg_exit_velo": round(a_velo, 1),
                "home_barrel_pct": round(h_barrel, 1),
                "away_barrel_pct": round(a_barrel, 1),
                "home_avg_bwar": round(h_bwar, 2),
                "away_avg_bwar": round(a_bwar, 2)
            }
        }

predictor = GamePredictor()