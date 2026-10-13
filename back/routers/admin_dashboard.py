
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from auth.jwt import decode_access_token
from database.db_connection import get_session
from models.user import User
from schemas.admin_dashboard import AdminDashboardStatsResponse


router = APIRouter(
    prefix="/admin/dashboard",
    tags=["Admin - Dashboard"],
)

bearer_scheme = HTTPBearer()


# ==================================================
# 관리자 인증
# ==================================================
def get_admin_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_session),
) -> User:
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("user_id")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 로그인 정보입니다.",
        )

    user = db.scalar(
        select(User).where(User.user_id == user_id)
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="회원 정보를 찾을 수 없습니다.",
        )

    if user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자만 접근할 수 있습니다.",
        )

    return user


# ==================================================
# 대시보드 통계 조회
# GET /admin/dashboard/stats
# ==================================================
@router.get(
    "/stats",
    response_model=AdminDashboardStatsResponse,
)
def get_dashboard_stats(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_session),
):
    # 오늘 날짜 범위
    today = date.today()
    today_start = datetime.combine(today, time.min)
    tomorrow_start = today_start + timedelta(days=1)

    # --------------------------------------------------
    # 1. 전체 회원 수
    # users 테이블 전체 행 수
    # --------------------------------------------------
    total_users = (
        db.scalar(
            select(func.count()).select_from(User)
        ) or 0
    )

    # --------------------------------------------------
    # 2. 오늘 가입자 수
    # users.created_at이 오늘인 회원
    # --------------------------------------------------
    today_users = (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.created_at >= today_start,
                User.created_at < tomorrow_start,
            )
        ) or 0
    )

    # --------------------------------------------------
    # 3. 전체 게시글 수
    # community_posts 테이블 전체 행 수
    # --------------------------------------------------
    total_posts = (
        db.scalar(
            select(func.count())
            .select_from(
                # 기존 모델을 추가하지 않고 SQLAlchemy Core로 조회
                __import__(
                    "sqlalchemy"
                ).Table(
                    "community_posts",
                    __import__(
                        "sqlalchemy"
                    ).MetaData(),
                    autoload_with=db.get_bind(),
                )
            )
        ) or 0
    )

    # --------------------------------------------------
    # 4. 미처리 신고 수
    # post_reports.status = 'PENDING'
    # --------------------------------------------------
    from sqlalchemy import text

    pending_reports = (
        db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM post_reports
                WHERE status = 'PENDING'
                """
            )
        ).scalar_one() or 0
    )

    # --------------------------------------------------
    # 5. 오늘 경기 수
    # games.game_date가 오늘인 경기
    # --------------------------------------------------
    from sqlalchemy import Table, MetaData

    games_table = Table(
        "games",
        MetaData(),
        autoload_with=db.get_bind(),
    )

    today_games = (
        db.scalar(
            select(func.count())
            .select_from(games_table)
            .where(
                games_table.c.game_date == today
            )
        ) or 0
    )

    # --------------------------------------------------
    # 6. 전체 예측 참여 수
    # prediction_votes 테이블 전체 행 수
    # --------------------------------------------------
    prediction_votes_table = Table(
        "prediction_votes",
        MetaData(),
        autoload_with=db.get_bind(),
    )

    prediction_participation = (
        db.scalar(
            select(func.count())
            .select_from(prediction_votes_table)
        ) or 0
    )

    # --------------------------------------------------
    # 통계 응답
    # --------------------------------------------------
    return AdminDashboardStatsResponse(
        total_users=total_users,
        today_users=today_users,
        total_posts=total_posts,
        pending_reports=pending_reports,
        today_games=today_games,
        prediction_participation=prediction_participation,
    )
