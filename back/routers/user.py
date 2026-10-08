from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.user import User
from models.team import Team

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