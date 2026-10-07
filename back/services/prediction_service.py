import os
from pathlib import Path

import joblib
import pandas as pd
from sqlalchemy import text

from database.db_connection import engine


# ==================================================
# 모델 경로
# ==================================================

MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "ml"
    / "game_prediction_model.pkl"
)


class GamePredictor:

    def __init__(self):

        self.model_data = None

        self.load_model()

    # ==================================================
    # 모델 로드
    # ==================================================

    def load_model(self):

        if os.path.exists(MODEL_PATH):

            self.model_data = joblib.load(
                MODEL_PATH
            )

        else:

            self.model_data = None

    # ==================================================
    # 팀 목록 조회
    # ==================================================

    def get_teams(self, conn):

        query = text("""
            SELECT
                team_id,
                team_name
            FROM teams
            ORDER BY team_name
        """)

        return conn.execute(
            query
        ).mappings().all()

    # ==================================================
    # 질문에서 팀 찾기
    # ==================================================

    def find_teams_from_question(
        self,
        conn,
        question: str
    ):

        teams = self.get_teams(conn)

        question_lower = question.lower()

        matched_teams = []

        # --------------------------------------------------
        # DB의 공식 팀 이름 검색
        # --------------------------------------------------

        for team in teams:

            team_name = team["team_name"]

            if not team_name:
                continue

            if team_name.lower() in question_lower:

                if not any(
                    item["team_id"] == team["team_id"]
                    for item in matched_teams
                ):

                    matched_teams.append({
                        "team_id": team["team_id"],
                        "team_name": team_name
                    })

        # --------------------------------------------------
        # 한국어 팀 별칭
        # --------------------------------------------------

        aliases = {

            "양키스": "New York Yankees",
            "뉴욕 양키스": "New York Yankees",

            "레드삭스": "Boston Red Sox",
            "보스턴 레드삭스": "Boston Red Sox",

            "다저스": "Los Angeles Dodgers",
            "LA 다저스": "Los Angeles Dodgers",
            "엘에이 다저스": "Los Angeles Dodgers",

            "애스트로스": "Houston Astros",
            "휴스턴 애스트로스": "Houston Astros",

            "컵스": "Chicago Cubs",
            "시카고 컵스": "Chicago Cubs",

            "메츠": "New York Mets",
            "뉴욕 메츠": "New York Mets",

            "파드리스": "San Diego Padres",
            "샌디에이고 파드리스": "San Diego Padres",

            "자이언츠": "San Francisco Giants",
            "샌프란시스코 자이언츠": "San Francisco Giants",

            "필리스": "Philadelphia Phillies",
            "필라델피아 필리스": "Philadelphia Phillies",

            "브레이브스": "Atlanta Braves",
            "애틀랜타 브레이브스": "Atlanta Braves",

            "가디언스": "Cleveland Guardians",
            "클리블랜드 가디언스": "Cleveland Guardians",

            "타이거스": "Detroit Tigers",
            "디트로이트 타이거스": "Detroit Tigers",

            "트윈스": "Minnesota Twins",
            "미네소타 트윈스": "Minnesota Twins",

            "화이트삭스": "Chicago White Sox",
            "시카고 화이트삭스": "Chicago White Sox",

            "로열스": "Kansas City Royals",
            "캔자스시티 로열스": "Kansas City Royals",

            "레인저스": "Texas Rangers",
            "텍사스 레인저스": "Texas Rangers",

            "매리너스": "Seattle Mariners",
            "시애틀 매리너스": "Seattle Mariners",

            "에인절스": "Los Angeles Angels",
            "LA 에인절스": "Los Angeles Angels",

            "블루제이스": "Toronto Blue Jays",
            "토론토 블루제이스": "Toronto Blue Jays",

            "오리올스": "Baltimore Orioles",
            "볼티모어 오리올스": "Baltimore Orioles",

            "레이스": "Tampa Bay Rays",
            "탬파베이 레이스": "Tampa Bay Rays",

            "레즈": "Cincinnati Reds",
            "신시내티 레즈": "Cincinnati Reds",

            "브루어스": "Milwaukee Brewers",
            "밀워키 브루어스": "Milwaukee Brewers",

            "카디널스": "St. Louis Cardinals",
            "세인트루이스 카디널스": "St. Louis Cardinals",

            "파이리츠": "Pittsburgh Pirates",
            "피츠버그": "Pittsburgh Pirates",

            "말린스": "Miami Marlins",
            "마이애미 말린스": "Miami Marlins",

            "내셔널스": "Washington Nationals",
            "워싱턴 내셔널스": "Washington Nationals",

            "로키스": "Colorado Rockies",
            "콜로라도 로키스": "Colorado Rockies",

            "다이아몬드백스": "Arizona Diamondbacks",
            "애리조나 다이아몬드백스": "Arizona Diamondbacks",

            "애슬레틱스": "Athletics"
        }

        for alias, official_name in aliases.items():

            if alias.lower() not in question_lower:
                continue

            for team in teams:

                team_name = team["team_name"]

                if not team_name:
                    continue

                if (
                    team_name.lower()
                    == official_name.lower()
                ):

                    if not any(
                        item["team_id"]
                        == team["team_id"]
                        for item in matched_teams
                    ):

                        matched_teams.append({
                            "team_id":
                                team["team_id"],

                            "team_name":
                                team_name
                        })

        # --------------------------------------------------
        # 두 팀을 찾지 못한 경우
        # --------------------------------------------------

        if len(matched_teams) < 2:

            return None, None

        return (
            matched_teams[0],
            matched_teams[1]
        )

    # ==================================================
    # 두 팀 상대전적
    # ==================================================

    def get_head_to_head_record(
        self,
        conn,
        team_a_id: int,
        team_b_id: int
    ):
        """두 팀 간의 맞대결 전적 집계"""

        h2h_query = text("""
            SELECT
                home_team_id,
                away_team_id,
                home_score,
                away_score
            FROM games
            WHERE
                status = 'FINAL'
                AND (
                    (
                        home_team_id = :team_a
                        AND away_team_id = :team_b
                    )
                    OR
                    (
                        home_team_id = :team_b
                        AND away_team_id = :team_a
                    )
                )
        """)

        matches = conn.execute(
            h2h_query,
            {
                "team_a": team_a_id,
                "team_b": team_b_id
            }
        ).mappings().all()

        total_games = len(matches)

        team_a_wins = 0
        team_b_wins = 0

        team_a_runs = 0
        team_b_runs = 0

        for match in matches:

            home_id = match["home_team_id"]

            home_score = match["home_score"]
            away_score = match["away_score"]

            if home_id == team_a_id:

                team_a_runs += home_score
                team_b_runs += away_score

                if home_score > away_score:

                    team_a_wins += 1

                elif away_score > home_score:

                    team_b_wins += 1

            else:

                team_b_runs += home_score
                team_a_runs += away_score

                if home_score > away_score:

                    team_b_wins += 1

                elif away_score > home_score:

                    team_a_wins += 1

        return {
            "total_games": total_games,

            "team_a_wins":
                team_a_wins,

            "team_b_wins":
                team_b_wins,

            "team_a_runs":
                team_a_runs,

            "team_b_runs":
                team_b_runs
        }

    # ==================================================
    # 경기 예측
    # ==================================================

    def predict_matchup(
        self,
        home_team_id: int,
        away_team_id: int
    ):

        # --------------------------------------------------
        # 모델 존재 여부
        # --------------------------------------------------

        if not self.model_data:

            self.load_model()

            if not self.model_data:

                raise FileNotFoundError(
                    "학습된 예측 모델(.pkl)이 존재하지 않습니다. "
                    "train_prediction_model.py를 먼저 실행해 주세요."
                )

        model = self.model_data["model"]

        feature_cols = self.model_data.get(
            "features",
            [
                "diff_avg_bwar",
                "diff_exit_velo",
                "diff_barrel_pct",
                "diff_batting_avg"
            ]
        )

        # --------------------------------------------------
        # DB 조회
        # --------------------------------------------------

        with engine.connect() as conn:

            # ==========================================
            # 1. 팀 세이버메트릭스
            # ==========================================

            query = text("""
                SELECT
                    p.team_id,

                    AVG(s.bwar)
                        AS avg_bwar,

                    AVG(s.avg_exit_velocity)
                        AS team_exit_velo,

                    AVG(s.barrel_percentage)
                        AS team_barrel_pct,

                    AVG(s.batting_avg)
                        AS team_batting_avg

                FROM players p

                JOIN player_season_stats s
                    ON p.player_id = s.player_id

                WHERE
                    p.team_id IN (
                        :home_id,
                        :away_id
                    )
                    AND s.season = 2024

                GROUP BY p.team_id
            """)

            rows = conn.execute(
                query,
                {
                    "home_id": home_team_id,
                    "away_id": away_team_id
                }
            ).mappings().all()

            # ==========================================
            # 2. 상대전적
            # ==========================================

            h2h = self.get_head_to_head_record(
                conn,
                home_team_id,
                away_team_id
            )

            # ==========================================
            # 3. 팀 이름
            # ==========================================

            team_query = text("""
                SELECT
                    team_id,
                    team_name
                FROM teams
                WHERE team_id IN (
                    :home_id,
                    :away_id
                )
            """)

            team_rows = conn.execute(
                team_query,
                {
                    "home_id": home_team_id,
                    "away_id": away_team_id
                }
            ).mappings().all()

        # --------------------------------------------------
        # 데이터 정리
        # --------------------------------------------------

        stats_map = {
            row["team_id"]: row
            for row in rows
        }

        team_map = {
            row["team_id"]: row["team_name"]
            for row in team_rows
        }

        h_stat = stats_map.get(
            home_team_id
        )

        a_stat = stats_map.get(
            away_team_id
        )

        # --------------------------------------------------
        # 팀 지표
        # --------------------------------------------------

        h_bwar = (
            float(h_stat["avg_bwar"])
            if h_stat
            and h_stat["avg_bwar"] is not None
            else 0.0
        )

        a_bwar = (
            float(a_stat["avg_bwar"])
            if a_stat
            and a_stat["avg_bwar"] is not None
            else 0.0
        )

        h_velo = (
            float(h_stat["team_exit_velo"])
            if h_stat
            and h_stat["team_exit_velo"] is not None
            else 88.0
        )

        a_velo = (
            float(a_stat["team_exit_velo"])
            if a_stat
            and a_stat["team_exit_velo"] is not None
            else 88.0
        )

        h_barrel = (
            float(h_stat["team_barrel_pct"])
            if h_stat
            and h_stat["team_barrel_pct"] is not None
            else 6.0
        )

        a_barrel = (
            float(a_stat["team_barrel_pct"])
            if a_stat
            and a_stat["team_barrel_pct"] is not None
            else 6.0
        )

        h_ba = (
            float(h_stat["team_batting_avg"])
            if h_stat
            and h_stat["team_batting_avg"] is not None
            else 0.240
        )

        a_ba = (
            float(a_stat["team_batting_avg"])
            if a_stat
            and a_stat["team_batting_avg"] is not None
            else 0.240
        )

        # --------------------------------------------------
        # 학습 때와 동일한 Feature 구성
        # --------------------------------------------------

        features = pd.DataFrame([
            {
                "diff_avg_bwar":
                    h_bwar - a_bwar,

                "diff_exit_velo":
                    h_velo - a_velo,

                "diff_barrel_pct":
                    h_barrel - a_barrel,

                "diff_batting_avg":
                    h_ba - a_ba
            }
        ])

        # 학습 당시 feature 순서와 동일하게
        features = features[
            feature_cols
        ]

        # --------------------------------------------------
        # 예측 확률
        # --------------------------------------------------

        probabilities = model.predict_proba(
            features
        )[0]

        classes = model.classes_

        prob_home_win = 0.5
        prob_away_win = 0.5

        for class_value, probability in zip(
            classes,
            probabilities
        ):

            if int(class_value) == 1:

                prob_home_win = float(
                    probability
                )

            elif int(class_value) == 0:

                prob_away_win = float(
                    probability
                )

        # --------------------------------------------------
        # 예측 승리팀
        # --------------------------------------------------

        predicted_winner_id = (
            home_team_id
            if prob_home_win >= 0.5
            else away_team_id
        )

        # --------------------------------------------------
        # 상대전적 요약
        # --------------------------------------------------

        if h2h["total_games"] > 0:

            h2h_summary = (
                f"상대전적: "
                f"{h2h['team_a_wins']}승 "
                f"{h2h['team_b_wins']}패"
            )

        else:

            h2h_summary = (
                "맞대결 기록 없음"
            )

        # --------------------------------------------------
        # 최종 결과
        # --------------------------------------------------

        return {

            "home_team_id":
                home_team_id,

            "away_team_id":
                away_team_id,

            "home_team_name":
                team_map.get(
                    home_team_id,
                    str(home_team_id)
                ),

            "away_team_name":
                team_map.get(
                    away_team_id,
                    str(away_team_id)
                ),

            "home_win_prob":
                round(
                    prob_home_win * 100,
                    1
                ),

            "away_win_prob":
                round(
                    prob_away_win * 100,
                    1
                ),

            "predicted_winner_id":
                predicted_winner_id,

            "predicted_winner_name":
                team_map.get(
                    predicted_winner_id,
                    str(predicted_winner_id)
                ),

            "head_to_head":
                h2h,

            "head_to_head_summary":
                h2h_summary,

            "metrics_comparison": {

                "home_avg_exit_velo":
                    round(h_velo, 1),

                "away_avg_exit_velo":
                    round(a_velo, 1),

                "home_barrel_pct":
                    round(h_barrel, 1),

                "away_barrel_pct":
                    round(a_barrel, 1),

                "home_avg_bwar":
                    round(h_bwar, 2),

                "away_avg_bwar":
                    round(a_bwar, 2),

                "home_batting_avg":
                    round(h_ba, 3),

                "away_batting_avg":
                    round(a_ba, 3)
            }
        }


# ==================================================
# 챗봇에서 사용할 Predictor
# ==================================================

predictor = GamePredictor()