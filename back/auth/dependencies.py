
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.user import User
from auth.jwt import decode_access_token


# 로그인 토큰 확인
bearer_scheme = HTTPBearer(auto_error=False)


# 현재 로그인한 사용자 가져오기
def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_session)
) -> User:

    # 토큰이 없는 경우
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="로그인이 필요합니다."
        )

    # 토큰 검증 및 사용자 정보 추출
    payload = decode_access_token(credentials.credentials)

    user_id = payload.get("user_id")

    # 토큰에 사용자 ID가 없는 경우
    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="유효하지 않은 로그인 정보입니다."
        )

    # DB에서 사용자 조회
    user = session.query(User).filter(
        User.user_id == user_id
    ).first()

    # 해당 사용자가 DB에 없는 경우
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="사용자를 찾을 수 없습니다."
        )

    return user
