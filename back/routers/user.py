from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user
from database.db_connection import get_session
from models.user import User
from models.team import Team
from datetime import datetime

from schemas.user import (
    UserInfoResponse,
    UserUpdateRequest,
    UserUpdateResponse,
    MyPageResponse
)

from auth.jwt import decode_access_token


router = APIRouter(
    prefix="/users",
    tags=["Users"]
)


# ==================================================
# JWT 인증
# ==================================================

security = HTTPBearer(
    auto_error=False
)


def get_current_user(
        credentials: HTTPAuthorizationCredentials = Depends(security),
        db: Session = Depends(get_session)
):

    # Authorization 헤더가 없는 경우
    if not credentials:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다."
        )

    # Bearer 뒤의 JWT
    token = credentials.credentials

    # JWT 검증
    payload = decode_access_token(token)

    # JWT에서 user_id 가져오기
    user_id = payload.get("user_id")

    if not user_id:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 로그인 정보입니다."
        )

    # DB에서 사용자 조회
    user = db.scalar(
        select(User).where(
            User.user_id == user_id
        )
    )

    if not user:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="회원을 찾을 수 없습니다."
        )

    return user


# ==================================================
# 회원 목록
# ==================================================

@router.get("/")
def get_users(
        db: Session = Depends(get_session)
):

    return {
        "message": "회원 목록"
    }


# ==================================================
# 현재 로그인 회원 정보 조회
# ==================================================

@router.get(
    "/me",
    response_model=UserInfoResponse
)
def get_my_info(
        current_user: User = Depends(get_current_user)
):

    return UserInfoResponse(
        user_id=current_user.user_id,
        username=current_user.username,
        nickname=current_user.nickname,
        email=current_user.email,
        favorite_team_id=current_user.favorite_team_id
    )


# ==================================================
# 회원정보 수정
# ==================================================

@router.put(
    "/me",
    response_model=UserUpdateResponse
)
def update_my_info(
        request_model: UserUpdateRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session)
):

    # ==================================================
    # 닉네임 중복 확인
    # ==================================================

    existing_nickname = db.scalar(
        select(User).where(
            User.nickname == request_model.nickname,
            User.user_id != current_user.user_id
        )
    )

    if existing_nickname:

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 닉네임입니다."
        )


    # ==================================================
    # 이메일 중복 확인
    # ==================================================

    existing_email = db.scalar(
        select(User).where(
            User.email == request_model.email,
            User.user_id != current_user.user_id
        )
    )

    if existing_email:

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 이메일입니다."
        )


    # ==================================================
    # 회원정보 수정
    # ==================================================

    current_user.nickname = request_model.nickname
    current_user.email = request_model.email
    current_user.favorite_team_id = request_model.favorite_team_id


    # ==================================================
    # DB 저장
    # ==================================================

    db.commit()
    db.refresh(current_user)


    # ==================================================
    # 응답
    # ==================================================

    return UserUpdateResponse(
        message="회원정보가 수정되었습니다.",
        user_id=current_user.user_id,
        username=current_user.username,
        nickname=current_user.nickname,
        email=current_user.email,
        favorite_team_id=current_user.favorite_team_id
    )


# ==================================================
# 마이페이지 회원정보 조회
# ==================================================

@router.get(
    "/mypage",
    response_model=MyPageResponse
)
def get_mypage_info(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session)
):

    # 관심 팀 이름
    favorite_team_name = None

    if current_user.favorite_team_id:

        favorite_team = db.scalar(
            select(Team).where(
                Team.team_id == current_user.favorite_team_id
            )
        )

        if favorite_team:
            favorite_team_name = favorite_team.team_name


    return MyPageResponse(
        user_id=current_user.user_id,
        username=current_user.username,
        nickname=current_user.nickname,
        email=current_user.email,

        favorite_team_id=current_user.favorite_team_id,
        favorite_team_name=favorite_team_name,

        point=current_user.point,
        grade=current_user.grade,

        prediction_streak=current_user.prediction_streak,
        max_prediction_streak=current_user.max_prediction_streak
    )

# ==================================================
# 회원 탈퇴 신청
# ==================================================

@router.post("/me/withdrawal-request")
def request_withdrawal(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
):
    # 이미 탈퇴한 회원
    if current_user.status == "WITHDRAWN":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 탈퇴 처리된 회원입니다."
        )

    # 이미 탈퇴 신청한 회원
    if current_user.status == "WITHDRAWAL_REQUESTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 탈퇴 신청이 접수되었습니다."
        )

    # 활동 정지 회원의 탈퇴 신청은 정책에 따라 제한
    if current_user.status == "RESTRICTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="활동 정지 상태에서는 탈퇴 신청을 진행할 수 없습니다."
        )

    # 탈퇴 신청 상태 및 신청 시간 저장
    current_user.status = "WITHDRAWAL_REQUESTED"
    current_user.withdrawal_requested_at = datetime.now()

    try:
        db.commit()
        db.refresh(current_user)

    except Exception:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="탈퇴 신청 처리 중 오류가 발생했습니다."
        )

    return {
        "message": "회원 탈퇴 신청이 접수되었습니다.",
        "status": current_user.status,
        "withdrawal_requested_at": (
            current_user.withdrawal_requested_at.isoformat()
        )
    }


# =========================================================
# 포인트 지급 내역 조회
# GET /users/points/history
# =========================================================
@router.get("/points/history")
def get_points_history(
    db: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        user_id = current_user.user_id

        query = text("""
            SELECT
                v.vote_id,
                g.game_date,
                g.game_time,
                home_team.team_name AS home_team_name,
                away_team.team_name AS away_team_name,
                selected_team.team_name AS selected_team_name,
                v.is_correct,
                v.reward_point,
                v.created_at
            FROM prediction_votes v
            JOIN games g
                ON v.game_id = g.game_id
            LEFT JOIN teams home_team
                ON g.home_team_id = home_team.team_id
            LEFT JOIN teams away_team
                ON g.away_team_id = away_team.team_id
            LEFT JOIN teams selected_team
                ON v.selected_team_id = selected_team.team_id
            WHERE v.user_id = :user_id
              AND COALESCE(v.reward_point, 0) > 0
            ORDER BY v.created_at DESC, v.vote_id DESC
        """)

        rows = db.execute(
            query,
            {"user_id": user_id},
        ).mappings().all()

        history = []

        for row in rows:
            history.append({
                "vote_id": row["vote_id"],
                "date": (
                    row["created_at"].isoformat()
                    if row["created_at"] else None
                ),
                "game_date": (
                    row["game_date"].isoformat()
                    if row["game_date"] else None
                ),
                "game_time": (
                    str(row["game_time"])
                    if row["game_time"] is not None
                    else None
                ),
                "game": (
                    f'{row["away_team_name"] or "원정팀"}'
                    f' vs {row["home_team_name"] or "홈팀"}'
                ),
                "selected_team": row["selected_team_name"],
                "result": (
                    "예측 적중 보상"
                    if row["is_correct"] == 1
                    else "예측 보상"
                ),
                "reward_point": int(row["reward_point"] or 0),
            })

        return {
            "history": history,
            "total_reward_point": sum(
                item["reward_point"] for item in history
            ),
            "count": len(history),
        }


    except Exception as e:

        import traceback

        print("\n========== 포인트 내역 API 오류 ==========")

        traceback.print_exc()

        print("==========================================\n")

        raise