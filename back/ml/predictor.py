from sqlalchemy import text
from sqlalchemy.orm import Session
from sklearn.linear_model import LogisticRegression


# ML 기반 경기 승부 예측 담당 파일
def get_team_win_rate(
        db: Session,
        team_id: int
):

    sql = text(
        """
        SELECT 
            COUNT(*) AS total_games,
            SUM(
                CASE 
                    WHEN winning_team_id = :team_id
                    THEN 1
                    ELSE 0
                END
            ) AS wins
        FROM games
        WHERE status = 'FINAL'
            AND (
                home_team_id = :team_id
                OR away_team_id = :team_id
            )
        """
    )

    result = db.execute(
        sql,
        {
            "team_id": team_id,
        }
    ).mappings().first()

    if not result:
        return 0.5

    total_games = result["total_games"] or 0
    wins = result["wins"] or 0

    if total_games == 0:
        return 0.5

    return wins / total_games

def predict_game(
        db: Session,
        home_team_id: int,
        away_team_id: int,
):

    home_win_rate = get_team_win_rate(
        db,
        home_team_id
    )

    away_win_rate = get_team_win_rate(
        db,
        away_team_id
    )

    # 학습 데이터가 충분하지 않은 경우
    # 기본적인 모델 입력값을 구성
    x = [
        [home_win_rate, away_win_rate],
        [away_win_rate, home_win_rate],
    ]

    y = [
        1,
        0
    ]

    model = LogisticRegression()

    model.fit(
        x,
        y
    )

    probability = model.predict_proba(
        [[
            home_win_rate,
            away_win_rate
        ]]
    )[0]

    home_probability = float(
        probability[1]
    )

    away_probability = float(
        probability[0]
    )

    if home_probability >= away_probability:
        predicted_team_id = home_team_id
    else:
        predicted_team_id = away_team_id

    return {
        "home_probability": home_probability,
        "away_probability": away_probability,
        "predicted_team_id": predicted_team_id
    }