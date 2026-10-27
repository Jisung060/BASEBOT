
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
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
from services.admin_activity_log_service import log_admin_activity


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/users", tags=["Admin - Users"])


# ==================================================
# 관리자 인증
# ==================================================

def get_admin_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    token = credentials.credentials
    payload = decode_access_token(token)

    user_id = payload.get("user_id")

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="유효하지 않은 로그인 정보입니다.",
        )

    user = db.scalar(
        select(User).where(User.user_id == user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="회원 정보를 찾을 수 없습니다.",
        )

    if user.role != "ADMIN":
        raise HTTPException(
            status_code=403,
            detail="관리자만 접근할 수 있습니다.",
        )

    return user


@router.get("/access-check")
def check_admin_access(admin: User = Depends(get_admin_user)):
    return {"status": "ok"}


# ==================================================
# 관리자 회원 작업 로그
# ==================================================

def write_user_activity_log(
    db: Session,
    admin: User,
    request: Request,
    *,
    action_detail: str,
    description: str,
    result: str,
    target_user_id: int,
    target_username: str,
    error_message: str | None = None,
) -> None:
    """
    관리자 회원 작업을 활동 로그 테이블에 기록한다.

    로그 저장 실패가 회원 작업의 결과에 영향을 주지 않도록
    로그 저장 예외는 기록하고 종료한다.
    """
    try:
        log_admin_activity(
            db,
            admin_id=admin.user_id,
            admin_username=admin.username,
            action_type="USER",
            action_detail=action_detail,
            description=description,
            result=result,
            target_type="USER",
            target_id=target_user_id,
            target_name=target_username,
            error_message=error_message,
            request=request,
        )
    except Exception:
        logger.exception(
            "관리자 회원 작업 로그 저장 실패: %s",
            action_detail,
        )


# ==================================================
# 회원 목록 조회
# GET /admin/users
# ==================================================

@router.get("", response_model=AdminUserListResponse)
def get_admin_users(
    keyword: str | None = Query(default=None),
    role: Literal["USER", "ADMIN"] | None = Query(default=None),
    status_filter: Literal[
        "ACTIVE",
        "RESTRICTED",
        "WITHDRAWAL_REQUESTED",
        "WITHDRAWN",
    ] | None = Query(default=None, alias="status"),
    sort_by: Literal[
        "user_id",
        "username",
        "nickname",
        "created_at",
    ] = Query(default="created_at"),
    order: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    conditions = []

    # 아이디, 닉네임, 이메일 검색
    if keyword and keyword.strip():
        search_keyword = f"%{keyword.strip()}%"

        conditions.append(
            or_(
                User.username.like(search_keyword),
                User.nickname.like(search_keyword),
                User.email.like(search_keyword),
            )
        )

    # 권한 필터
    if role:
        conditions.append(User.role == role)

    # 회원 상태 필터
    if status_filter:
        conditions.append(User.status == status_filter)

    # 전체 회원 수
    count_query = (
        select(func.count())
        .select_from(User)
        .where(*conditions)
    )

    total = db.scalar(count_query) or 0

    # 정렬 컬럼
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


# ==================================================
# 회원 상세 조회
# GET /admin/users/{user_id}
# ==================================================

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

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="회원을 찾을 수 없습니다.",
        )

    return AdminUserDetailResponse.model_validate(user)


# ==================================================
# 회원 탈퇴 승인
# POST /admin/users/{user_id}/withdrawal/approve
# ==================================================

@router.post("/{user_id}/withdrawal/approve")
def approve_withdrawal(
    user_id: int,
    request: Request,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    user = db.scalar(
        select(User).where(User.user_id == user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="회원을 찾을 수 없습니다.",
        )

    if user.status != "WITHDRAWAL_REQUESTED":
        raise HTTPException(
            status_code=400,
            detail="탈퇴 신청 상태인 회원만 승인할 수 있습니다.",
        )

    # 롤백 이후에도 사용할 수 있도록 대상 정보 저장
    target_user_id = user.user_id
    target_username = user.username

    # 탈퇴 승인 처리
    user.status = "WITHDRAWN"

    try:
        db.commit()
        db.refresh(user)

    except Exception as exc:
        db.rollback()

        # DB 처리 실패 로그
        write_user_activity_log(
            db,
            admin,
            request,
            action_detail="WITHDRAWAL_APPROVE",
            description=(
                f"회원 탈퇴 승인 실패: {target_username}"
            ),
            result="FAILURE",
            target_user_id=target_user_id,
            target_username=target_username,
            error_message=str(exc),
        )

        logger.exception("회원 탈퇴 승인 처리 실패")

        raise HTTPException(
            status_code=500,
            detail="탈퇴 승인 처리에 실패했습니다.",
        ) from exc

    # 탈퇴 승인 성공 로그
    write_user_activity_log(
        db,
        admin,
        request,
        action_detail="WITHDRAWAL_APPROVE",
        description=(
            f"회원 탈퇴 승인: {target_username}"
        ),
        result="SUCCESS",
        target_user_id=target_user_id,
        target_username=target_username,
    )

    return {
        "message": "회원 탈퇴가 승인되었습니다.",
        "user_id": user.user_id,
        "status": user.status,
    }


# ==================================================
# 회원 탈퇴 반려
# POST /admin/users/{user_id}/withdrawal/reject
# ==================================================

@router.post("/{user_id}/withdrawal/reject")
def reject_withdrawal(
    user_id: int,
    request: Request,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    user = db.scalar(
        select(User).where(User.user_id == user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="회원을 찾을 수 없습니다.",
        )

    if user.status != "WITHDRAWAL_REQUESTED":
        raise HTTPException(
            status_code=400,
            detail="탈퇴 신청 상태인 회원만 반려할 수 있습니다.",
        )

    # 롤백 이후에도 사용할 수 있도록 대상 정보 저장
    target_user_id = user.user_id
    target_username = user.username

    # 탈퇴 신청 반려 처리
    user.status = "ACTIVE"
    user.withdrawal_requested_at = None

    try:
        db.commit()
        db.refresh(user)

    except Exception as exc:
        db.rollback()

        # DB 처리 실패 로그
        write_user_activity_log(
            db,
            admin,
            request,
            action_detail="WITHDRAWAL_REJECT",
            description=(
                f"회원 탈퇴 신청 반려 실패: {target_username}"
            ),
            result="FAILURE",
            target_user_id=target_user_id,
            target_username=target_username,
            error_message=str(exc),
        )

        logger.exception("회원 탈퇴 반려 처리 실패")

        raise HTTPException(
            status_code=500,
            detail="탈퇴 반려 처리에 실패했습니다.",
        ) from exc

    # 탈퇴 반려 성공 로그
    write_user_activity_log(
        db,
        admin,
        request,
        action_detail="WITHDRAWAL_REJECT",
        description=(
            f"회원 탈퇴 신청 반려: {target_username}"
        ),
        result="SUCCESS",
        target_user_id=target_user_id,
        target_username=target_username,
    )

    return {
        "message": "회원 탈퇴 신청이 반려되었습니다.",
        "user_id": user.user_id,
        "status": user.status,
    }
