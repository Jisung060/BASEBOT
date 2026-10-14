
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session

from auth.dependencies import bearer_scheme
from auth.jwt import decode_access_token
from database.db_connection import get_session
from models.user import User
from models.community import CommunityPost
from models.comment import Comment
from models.post_report import PostReport


router = APIRouter(
    prefix="/admin/community",
    tags=["Admin - Community"],
)


# ========================================
# 관리자 인증
# ========================================

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


# ========================================
# 게시글 목록 / 검색
# GET /admin/community/posts
# ========================================

@router.get("/posts")
def get_admin_community_posts(
    keyword: str | None = Query(default=None),
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    report_count_query = (
        select(func.count(PostReport.report_id))
        .where(PostReport.post_id == CommunityPost.post_id)
        .correlate(CommunityPost)
        .scalar_subquery()
    )

    query = (
        select(
            CommunityPost,
            User.nickname,
            report_count_query.label("report_count"),
        )
        .join(User, CommunityPost.user_id == User.user_id)
    )

    if keyword and keyword.strip():
        search = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                CommunityPost.title.like(search),
                CommunityPost.content.like(search),
                User.nickname.like(search),
            )
        )

    rows = db.execute(
        query.order_by(CommunityPost.created_at.desc())
    ).all()

    return {
        "total": len(rows),
        "items": [
            {
                "post_id": post.post_id,
                "type": "post",
                "title": post.title,
                "content": post.content,
                "nickname": nickname,
                "created_at": post.created_at,
                "report_count": report_count,
                "status": "ACTIVE",
                "category": post.category,
                "comment_count": post.comment_count,
            }
            for post, nickname, report_count in rows
        ],
    }


# ========================================
# 댓글 목록 / 검색
# GET /admin/community/comments
# ========================================

@router.get("/comments")
def get_admin_community_comments(
    keyword: str | None = Query(default=None),
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    query = (
        select(
            Comment,
            User.nickname,
            CommunityPost.title.label("post_title"),
        )
        .join(User, Comment.user_id == User.user_id)
        .join(
            CommunityPost,
            Comment.post_id == CommunityPost.post_id,
        )
    )

    if keyword and keyword.strip():
        search = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                Comment.content.like(search),
                User.nickname.like(search),
                CommunityPost.title.like(search),
            )
        )

    rows = db.execute(
        query.order_by(Comment.created_at.desc())
    ).all()

    return {
        "total": len(rows),
        "items": [
            {
                "comment_id": comment.comment_id,
                "post_id": comment.post_id,
                "type": "comment",
                "title": post_title,
                "content": comment.content,
                "nickname": nickname,
                "created_at": comment.created_at,
                "report_count": 0,
                "status": "ACTIVE",
            }
            for comment, nickname, post_title in rows
        ],
    }


# ========================================
# 전체 신고 목록 / 검색 / 상태 필터
# GET /admin/community/reports
# ========================================

@router.get("/reports")
def get_admin_community_reports(
    keyword: str | None = Query(default=None),
    report_status: str | None = Query(default=None),
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    allowed_statuses = {
        "PENDING",
        "REVIEWED",
        "REJECTED",
        "ACCEPTED",
    }

    if report_status and report_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="올바른 신고 상태가 아닙니다.",
        )

    query = (
        select(
            PostReport,
            CommunityPost.title,
            User.nickname,
        )
        .join(
            CommunityPost,
            PostReport.post_id == CommunityPost.post_id,
        )
        .join(
            User,
            PostReport.user_id == User.user_id,
        )
    )

    if report_status:
        query = query.where(PostReport.status == report_status)

    if keyword and keyword.strip():
        search = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                CommunityPost.title.like(search),
                User.nickname.like(search),
                PostReport.reason.like(search),
                PostReport.content.like(search),
            )
        )

    rows = db.execute(
        query.order_by(PostReport.created_at.desc())
    ).all()

    return {
        "total": len(rows),
        "pending_count": sum(
            1 for report, _, _ in rows
            if report.status == "PENDING"
        ),
        "items": [
            {
                "report_id": report.report_id,
                "post_id": report.post_id,
                "title": title,
                "reason": report.reason,
                "report_content": report.content,
                "nickname": nickname,
                "status": report.status,
                "reported_at": report.created_at,
            }
            for report, title, nickname in rows
        ],
    }
