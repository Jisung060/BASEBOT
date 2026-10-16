from datetime import datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.admin_activity_log import AdminActivityLog
from routers.admin_users import get_admin_user
from models.user import User


router = APIRouter(
    prefix="/admin/activity-logs",
    tags=["Admin Activity Logs"],
)


@router.get("")
def get_admin_activity_logs(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    keyword: Optional[str] = Query(default=None),
    admin_username: Optional[str] = Query(default=None),
    action_type: Optional[str] = Query(default=None),
    result: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    query = db.query(AdminActivityLog)

    # 일반 키워드 검색
    if keyword and keyword.strip():
        search = f"%{keyword.strip()}%"

        query = query.filter(
            or_(
                AdminActivityLog.admin_username.like(search),
                AdminActivityLog.action_type.like(search),
                AdminActivityLog.action_detail.like(search),
                AdminActivityLog.description.like(search),
                AdminActivityLog.target_name.like(search),
                AdminActivityLog.target_id.like(search),
            )
        )

    # 관리자 아이디 검색
    if admin_username and admin_username.strip():
        query = query.filter(
            AdminActivityLog.admin_username.like(
                f"%{admin_username.strip()}%"
            )
        )

    # 작업 유형 필터
    if action_type:
        query = query.filter(
            AdminActivityLog.action_type == action_type
        )

    # 처리 결과 필터
    if result:
        if result not in ("SUCCESS", "FAILURE"):
            raise HTTPException(
                status_code=400,
                detail="result는 SUCCESS 또는 FAILURE여야 합니다.",
            )

        query = query.filter(
            AdminActivityLog.result == result
        )

    # 날짜 필터
    try:
        if start_date:
            start = datetime.strptime(
                start_date, "%Y-%m-%d"
            ).date()

            query = query.filter(
                AdminActivityLog.created_at
                >= datetime.combine(start, time.min)
            )

        if end_date:
            end = datetime.strptime(
                end_date, "%Y-%m-%d"
            ).date() + timedelta(days=1)

            # 종료일의 다음 날 00:00 미만까지 조회
            query = query.filter(
                AdminActivityLog.created_at
                < datetime.combine(end, time.min)
            )

        if start_date and end_date:
            if start > (end - timedelta(days=1)):
                raise HTTPException(
                    status_code=400,
                    detail="시작일은 종료일보다 늦을 수 없습니다.",
                )

    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="날짜는 YYYY-MM-DD 형식이어야 합니다.",
        )

    # 전체 검색 결과 수
    total = query.count()

    # 최신 로그부터 페이지 단위 조회
    logs = (
        query.order_by(
            AdminActivityLog.created_at.desc(),
            AdminActivityLog.log_id.desc(),
        )
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    return {
        "items": [
            {
                "log_id": log.log_id,
                "admin_id": log.admin_id,
                "admin_username": log.admin_username,
                "action_type": log.action_type,
                "action_detail": log.action_detail,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "target_name": log.target_name,
                "description": log.description,
                "result": log.result,
                "error_message": log.error_message,
                "ip_address": log.ip_address,
                "created_at": (
                    log.created_at.isoformat()
                    if log.created_at
                    else None
                ),
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "size": size,
        "total_pages": (total + size - 1) // size,
    }


@router.get("/recent")
def get_recent_admin_activity_logs(
    days: int = Query(7, ge=1, le=30),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    """최근 N일간의 모든 관리자 활동 이력 조회"""

    since = datetime.now() - timedelta(days=days)

    logs = (
        db.query(AdminActivityLog)
        .filter(
            AdminActivityLog.created_at >= since
        )
        .order_by(
            AdminActivityLog.created_at.desc(),
            AdminActivityLog.log_id.desc(),
        )
        .all()
    )

    return {
        "items": [
            {
                "log_id": log.log_id,
                "admin_id": log.admin_id,
                "admin_username": log.admin_username,
                "action_type": log.action_type,
                "action_detail": log.action_detail,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "target_name": log.target_name,
                "description": log.description,
                "result": log.result,
                "error_message": log.error_message,
                "ip_address": log.ip_address,
                "created_at": (
                    log.created_at.isoformat()
                    if log.created_at
                    else None
                ),
            }
            for log in logs
        ],
        "total": len(logs),
        "days": days,
    }