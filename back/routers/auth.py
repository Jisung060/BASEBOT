from aiohttp import payload
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.user import User

from schemas.user import (
    SignupRequest,
    SignupResponse,
    UsernameCheckResponse,
    LoginRequest,
    LoginResponse,
    FindIdRequest,
    FindIdResponse,
    PasswordResetRequest,
    PasswordResetResponse,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
)
from auth.password import hash_password, verify_password
from auth.jwt import create_access_token

router = APIRouter(
    prefix="/auth",
    tags=["Auth"]
)

# 회원가입
@router.post(
    "/signup",
    response_model=SignupResponse,
    status_code=status.HTTP_201_CREATED
)
def signup(
        request_model: SignupRequest,
        db: Session = Depends(get_session),
):

    # 아이디 중복 확인
    existing_user = db.scalar(
        select(User).where(
            User.username == request_model.username
        )
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="이미 사용 중인 아이디 입니다."
        )

    # 닉네임 중복 확인
    existing_nickname = db.scalar(
        select(User).where(
            User.nickname == request_model.nickname
        )
    )

    if existing_nickname:
        raise HTTPException(
            status_code=409,
            detail="이미 사용 중인 닉네임입니다."
        )

    # 이메일 중복 확인
    existing_email = db.scalar(
        select(User).where(
            User.email == request_model.email
        )
    )

    if existing_email:
        raise HTTPException(
            status_code=409,
            detail="이미 사용중인 이메일입니다."
        )

    # 비밀번호 해시
    hashed_password = hash_password(
        request_model.password
    )

    # 회원 객체 생성
    user = User(
        username=request_model.username,
        password=hashed_password,
        nickname=request_model.nickname,
        email=request_model.email,
        favorite_team_id=request_model.favorite_team_id,
    )

    # DB 저장
    db.add(user)
    db.commit()
    db.refresh(user)

    # 응답
    return SignupResponse(
        user_id=user.user_id,
        username=user.username,
        nickname=user.nickname,
        email=user.email,
        favorite_team_id=user.favorite_team_id,
    )

# 아이디 중복확인
@router.get(
    "/username-check",
    response_model=UsernameCheckResponse
)
def username_check(
        username: str,
        db: Session = Depends(get_session),
):
    existing_user = db.scalar(
        select(User).where(
            User.username == username
        )
    )

    if existing_user:
        return UsernameCheckResponse(
            available=False,
            message="이미 사용 중인 아이디입니다."
        )

    return UsernameCheckResponse(
        available=True,
        message="사용 가능한 아이디입니다."
    )

# 로그인
@router.post(
    "/login",
    response_model=LoginResponse
)
def login(
        request_model: LoginRequest,
        db: Session = Depends(get_session),
):
    # 1. 아이디로 회원 조회
    user = db.scalar(
        select(User).where(
            User.username == request_model.username
        )
    )

    # 2. 아이디가 없거나 비밀번호가 틀린 경우
    if not user or not verify_password(
        request_model.password,
        user.password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다."
        )

    # 3. JWT 생성
    access_token = create_access_token(
        user_id=user.user_id,
        username=user.username
    )

    # 4. 로그인 결과 반환
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.user_id,
        username=user.username,
        nickname=user.nickname
    )

@router.post(
    "/find-id",
    response_model=FindIdResponse
)
def find_id(
        request_model: FindIdRequest,
        db: Session = Depends(get_session)
):
    user = db.scalar(
        select(User).where(
            User.nickname == request_model.nickname,
            User.email == request_model.email
        )
    )
    if not user:
        raise HTTPException(
            status_code=404,
            detail="입력하신 정보와 일치하는 회원이 없습니다."
        )
    return FindIdResponse(
        username=user.username
    )

# 아이디 + 이메일 확인
@router.post(
    "/verify-password-reset",
    response_model=PasswordResetVerifyResponse
)
def verify_password_reset(
        request_model: PasswordResetVerifyRequest,
        db: Session = Depends(get_session),
):
    user = db.scalar(
        select(User).where(
            User.username == request_model.username,
            User.email == request_model.email
        )
    )

    if not user:
        raise HTTPException(
            status_code=404,
            detail="입력하신 정보와 일치하는 회원이 없습니다."
        )
    return PasswordResetVerifyResponse(
        verified=True
    )

# 비밀번호 변경
@router.post(
    "/reset-password",
    response_model=PasswordResetResponse
)
def reset_password(
        request_model: PasswordResetRequest,
        db: Session = Depends(get_session),
):
    print("===== 비밀번호 변경 시작 =====")

    print("username:", request_model.username)
    print("email:", request_model.email)

    user = db.scalar(
        select(User).where(
            User.username == request_model.username,
            User.email == request_model.email
        )
    )

    print("조회된 user:", user)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="입력하신 정보와 일치하는 회원이 없습니다."
        )

    # 기존 비밀번호
    print("기존 password:", user.password)

    # 새 비밀번호 해싱
    user.password = hash_password(
        request_model.new_password
    )

    print("변경된 password:", user.password)

    db.commit()

    print("===== DB commit 완료 =====")

    return PasswordResetResponse(
        message="비밀번호가 변경되었습니다."
    )