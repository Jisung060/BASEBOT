from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from auth.jwt import decode_access_token

router = APIRouter(
    prefix="/mypage",
    tags=["마이페이지"],
)

security = HTTPBearer(auto_error=False)

# 로그인 사용자 확인
def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> int:

    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="로그인이 필요합니다."
        )
    try:
        payload = decode_access_token(credentials.credentials)
        # JWT payload에서 user_id 추출
        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(
                status_code=401,
                detail="유효하지 않은 로그인 토큰입니다."
            )

        return int(user_id)

    except HTTPException:
        raise

    except (TypeError, ValueError, AttributeError):
        raise HTTPException(
            status_code=401,
            detail="로그인 토큰에서 사용자 정보를 확인할 수 없습니다."
        )

@router.get("/favorite-team")
def get_favorite_team(
        user_id: int = Depends(get_current_user_id),
        db: Session = Depends(get_session)
):
    # 1. 로그인 사용자의 관심 팀 조회
    team_sql = text(
        """
        SELECT t.team_id, t.team_name, t.team_code, t.league,
            t.division, t.city, t.stadium, t.logo_url
        FROM users u 
        LEFT JOIN teams t ON t.team_id = u.favorite_team_id
        WHERE u.user_id = :user_id
        """
    )

    team = db.execute(
        team_sql,
        {"user_id": user_id}
    ).mappings().first()

    if team is None:
        raise HTTPException(
            status_code=404,
            detail="사용자의 정보를 찾을 수 없습니다."
        )

    # 관심 팀을 선택하지 않은 경우
    if team["team_id"] is None:
        return {
            "favorite_team": None,
            "recent_games": []
        }
    team_id = team["team_id"]

    # 2. 관심 팀의 최근 경기 조회
    games_sql = text(
        """
        SELECT
            g.game_id, g.game_date, g.game_time, g.stadium,
            g.home_team_id, g.away_team_id, g.home_score, g.away_score,
            g.winning_team_id, g.status,

            home.team_name AS home_team_name,
            home.team_code AS home_team_code,
            home.logo_url AS home_team_logo,

            away.team_name AS away_team_name,
            away.team_code AS away_team_code,
            away.logo_url AS away_team_logo

        FROM games g

        INNER JOIN teams home
            ON g.home_team_id = home.team_id

        INNER JOIN teams away
            ON g.away_team_id = away.team_id

        WHERE
            g.home_team_id = :team_id
            OR g.away_team_id = :team_id

        ORDER BY
            g.game_date DESC,
            g.game_time DESC,
            g.game_id DESC

        LIMIT 5
        """
    )

    rows = db.execute(
        games_sql,
        {"team_id": team_id}
    ).mappings().all()

    recent_games = []

    for row in rows:
        game = dict(row)

        is_home = game["home_team_id"] == team_id

        if is_home:
            game["opponent_team_id"] = game["away_team_id"]
            game["opponent_team_name"] = game["away_team_name"]
            game["opponent_team_code"] = game["away_team_code"]
            game["opponent_team_logo"] = game["away_team_logo"]

            game["favorite_team_score"] = game["home_score"]
            game["opponent_team_score"] = game["away_score"]

        else:
            game["opponent_team_id"] = game["home_team_id"]
            game["opponent_team_name"] = game["home_team_name"]
            game["opponent_team_code"] = game["home_team_code"]
            game["opponent_team_logo"] = game["home_team_logo"]

            game["favorite_team_score"] = game["away_score"]
            game["opponent_team_score"] = game["home_score"]

        game["is_home"] = is_home

        # 종료된 경기의 승패 판정
        # 종료된 경기의 승패 판정
        if game["status"] == "FINAL":
            favorite_score = game["favorite_team_score"]
            opponent_score = game["opponent_team_score"]

            if favorite_score is None or opponent_score is None:
                game["result"] = None

            elif favorite_score > opponent_score:
                game["result"] = "WIN"

            elif favorite_score < opponent_score:
                game["result"] = "LOSS"

            else:
                game["result"] = "DRAW"

        else:
            game["result"] = None

        recent_games.append(game)

        # -----------------------------------------------------
        # 3. 응답 반환
        # -----------------------------------------------------
    return {
        "favorite_team": dict(team),
        "recent_games": recent_games
    }