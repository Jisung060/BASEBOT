
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from routers.user import get_current_user
from models.user import User


router = APIRouter(
    prefix="/api/mypage",
    tags=["마이페이지 예측 기록"]
)


# ==================================================
# 마이페이지 경기 예측 기록 조회
# ==================================================

@router.get("/prediction-history")
def get_prediction_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
):
    # 현재 로그인한 사용자 ID
    user_id = current_user.user_id

    # ==================================================
    # 1. 예측 기록 통계 조회
    # ==================================================

    stats_sql = text("""
        SELECT
            COUNT(*) AS total_predictions,

            SUM(
                CASE
                    WHEN g.status = 'FINAL'
                         AND pv.is_correct = 1
                    THEN 1
                    ELSE 0
                END
            ) AS correct_predictions,

            SUM(
                CASE
                    WHEN g.status = 'FINAL'
                         AND pv.is_correct = 0
                    THEN 1
                    ELSE 0
                END
            ) AS incorrect_predictions

        FROM prediction_votes pv

        JOIN games g
            ON pv.game_id = g.game_id

        WHERE pv.user_id = :user_id
    """)

    stats_row = db.execute(
        stats_sql,
        {"user_id": user_id}
    ).mappings().first()

    total_predictions = (
        stats_row["total_predictions"] or 0
    )

    correct_predictions = (
        stats_row["correct_predictions"] or 0
    )

    incorrect_predictions = (
        stats_row["incorrect_predictions"] or 0
    )

    # 결과가 확정된 예측만 적중률 계산에 포함
    completed_predictions = (
        correct_predictions + incorrect_predictions
    )

    if completed_predictions > 0:
        accuracy = round(
            correct_predictions / completed_predictions * 100,
            1
        )
    else:
        accuracy = 0.0

    # ==================================================
    # 2. 최근 예측 기록 조회
    # ==================================================

    history_sql = text("""
        SELECT
            pv.vote_id,
            pv.game_id,
            pv.created_at,
            pv.selected_team_id,
            pv.is_correct,

            g.game_date,
            g.game_time,
            g.status,
            g.home_score,
            g.away_score,
            g.winning_team_id,

            home.team_name AS home_team_name,
            away.team_name AS away_team_name,
            selected.team_name AS selected_team_name,
            winner.team_name AS winning_team_name

        FROM prediction_votes pv

        JOIN games g
            ON pv.game_id = g.game_id

        JOIN teams home
            ON g.home_team_id = home.team_id

        JOIN teams away
            ON g.away_team_id = away.team_id

        JOIN teams selected
            ON pv.selected_team_id = selected.team_id

        LEFT JOIN teams winner
            ON g.winning_team_id = winner.team_id

        WHERE pv.user_id = :user_id

        ORDER BY pv.created_at DESC, pv.vote_id DESC

        LIMIT 50
    """)

    history_rows = db.execute(
        history_sql,
        {"user_id": user_id}
    ).mappings().all()

    history = []

    for row in history_rows:

        # ----------------------------------------------
        # 경기 대진
        # ----------------------------------------------

        game_name = (
            f'{row["away_team_name"]} vs '
            f'{row["home_team_name"]}'
        )

        # ----------------------------------------------
        # 실제 경기 결과
        # ----------------------------------------------

        if row["status"] == "FINAL":

            game_result = (
                f'{row["home_team_name"]} '
                f'{row["home_score"]} : {row["away_score"]} '
                f'{row["away_team_name"]}'
            )

        elif row["status"] == "IN_PROGRESS":

            game_result = "경기 진행 중"

        elif row["status"] == "CANCELLED":

            game_result = "경기 취소"

        else:

            game_result = "경기 전"

        # ----------------------------------------------
        # 예측 결과
        # ----------------------------------------------

        if row["status"] == "CANCELLED":

            prediction_result = "경기 취소"

        elif (
            row["status"] == "FINAL"
            and row["is_correct"] == 1
        ):

            prediction_result = "적중"

        elif (
            row["status"] == "FINAL"
            and row["is_correct"] == 0
        ):

            prediction_result = "실패"

        else:

            prediction_result = "결과 대기"

        # ----------------------------------------------
        # 기록 추가
        # ----------------------------------------------

        history.append({
            "vote_id": row["vote_id"],
            "game_id": row["game_id"],

            "date": row["game_date"],
            "created_at": row["created_at"],

            "game": game_name,

            "selected_team": row["selected_team_name"],

            "game_result": game_result,

            "winning_team": row["winning_team_name"],

            "prediction_result": prediction_result,

            "status": row["status"]
        })

    # ==================================================
    # 3. 응답 반환
    # ==================================================

    return {
        "stats": {
            "total_predictions": total_predictions,
            "correct_predictions": correct_predictions,
            "incorrect_predictions": incorrect_predictions,
            "accuracy": accuracy
        },

        "history": history
    }
