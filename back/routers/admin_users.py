
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select, or_, func, asc, desc
from sqlalchemy.orm import Session

from auth.dependencies import bearer_scheme
from auth.jwt import decode_access_token
from database.db_connection import get_session
from models.user import User
from schemas.admin_user import (
    AdminUserItem,
    AdminUserListResponse,
    AdminUserDetailResponse,
)

router = APIRouter(
    prefix="/admin/users",
    tags=["Admin - Users"],
)

bearer_scheme = HTTPBearer()

def get_admin_user(
        credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
        db: Session = Depends(get_session)
) -> User:
    token = credentials.credentials

    # JWT 검증
    payload = decode_access_token(token)

    user_id = payload.get("user_id")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 로그인 정보입니다.",
        )

    user = db.scalar(
        select(User).where(User.user_id==user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="회원 정보를 찾을 수 없습니다."
        )

    if user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="관리자만 접근할 수 있습니다."
        )

    return user

# 회원 목록 / 검색 / 필터 / 정렬
@router.get(
    "",
    response_model=AdminUserListResponse,
)
def get_admin_users(
    keyword: str | None = Query(default=None),
    role: Literal["USER", "ADMIN"] | None = Query(default=None),
    status_filter: Literal[
        "ACTIVE", "RESTRICTED", "WITHDRAWN"
    ] | None = Query(default=None, alias="status"),
    sort_by: Literal[
        "user_id", "username", "nickname", "created_at"
    ] = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    # 검색 및 필터 조건
    conditions = []

    if keyword and keyword.strip():
        search_keyword = f"%{keyword.strip()}%"

        conditions.append(
            or_(
                User.username.like(search_keyword),
                User.nickname.like(search_keyword),
                User.email.like(search_keyword),
            )
        )

    if role:
        conditions.append(User.role == role)

    if status_filter:
        conditions.append(User.status == status_filter)

    # 전체 검색 결과 개수
    count_query = (
        select(func.count())
        .select_from(User)
        .where(*conditions)
    )

    total = db.scalar(count_query) or 0

    # 정렬 기준
    sort_column = {
        "user_id": User.user_id,
        "username": User.username,
        "nickname": User.nickname,
        "created_at": User.created_at,
    }[sort_by]

    sort_expression = (
        asc(sort_column)
        if order == "asc"
        else desc(sort_column)
    )

    # 회원 목록 조회
    query = (
        select(User)
        .where(*conditions)
        .order_by(sort_expression, User.user_id.desc())
        .offset(offset)
        .limit(limit)
    )

    users = db.scalars(query).all()

    return AdminUserListResponse(
        total=total,
        items=[
            AdminUserItem.model_validate(user)
            for user in users
        ],
    )

# 회원 상세 조회
@router.get(
    "/{user_id}",
    response_model=AdminUserDetailResponse,
)
def get_admin_user_detail(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    user = db.scalar(
        select(User).where(User.user_id == user_id)
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="회원을 찾을 수 없습니다.",
        )

    return AdminUserDetailResponse.model_validate(user)
