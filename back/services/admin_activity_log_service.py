
from typing import Optional, Union

from fastapi import Request
from sqlalchemy.orm import Session

from models.admin_activity_log import AdminActivityLog


def log_admin_activity(
    db: Session,
    *,
    admin_id: Optional[int],
    admin_username: str,
    action_type: str,
    action_detail: str,
    description: str,
    result: str,
    target_type: Optional[str] = None,
    target_id: Optional[Union[str, int]] = None,
    target_name: Optional[str] = None,
    error_message: Optional[str] = None,
    request: Optional[Request] = None,
) -> AdminActivityLog:
    """
    관리자 활동 로그를 DB에 저장한다.

    result:
        SUCCESS - 작업 성공
        FAILURE - 작업 실패
    """

    if result not in ("SUCCESS", "FAILURE"):
        raise ValueError(
            "result는 SUCCESS 또는 FAILURE여야 합니다."
        )

    if not admin_username:
        raise ValueError("관리자 아이디가 필요합니다.")

    if not action_type or not action_detail:
        raise ValueError("작업 유형과 세부 작업 코드는 필수입니다.")

    if not description:
        raise ValueError("작업 상세 내용은 필수입니다.")

    if result == "SUCCESS":
        error_message = None

    ip_address = None

    if request is not None and request.client is not None:
        ip_address = request.client.host

    log = AdminActivityLog(
        admin_id=admin_id,
        admin_username=admin_username,
        action_type=action_type,
        action_detail=action_detail,
        target_type=target_type,
        target_id=(
            str(target_id)
            if target_id is not None
            else None
        ),
        target_name=target_name,
        description=description,
        result=result,
        error_message=error_message,
        ip_address=ip_address,
    )

    try:
        db.add(log)
        db.commit()
        db.refresh(log)

        return log

    except Exception:
        db.rollback()
        raise
