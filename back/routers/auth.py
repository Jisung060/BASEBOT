from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.users import User
from schemas.user import LoginRequest


router = APIRouter(
    prefix="/auth",
    tags=["Auth"]
)


@router.post("/login")
def login(
    request: LoginRequest,
    session: Session = Depends(get_session)
):
    statement = select(User).where(
        User.username == request.username,
        User.password == request.password
    )

    user = session.scalar(statement)

    if user is None:
        return {
            "success": False,
            "message": "아이디 또는 비밀번호가 올바르지 않습니다."
        }

    return {
        "success": True,
        "message": "로그인 성공",
        "user": {
            "user_id": user.user_id,
            "username": user.username,
            "nickname": user.nickname,
            "grade": user.grade,
            "point": user.point
        }
    }