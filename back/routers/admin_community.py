
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session
import os
from models.community_image import CommunityImage

from datetime import datetime
from typing import Literal


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
                "status": post.status,
                "category": post.category,
                "comment_count": post.comment_count,
            }
            for post, nickname, report_count in rows
        ],
    }


# ========================================
# 관리자 게시글 삭제
# DELETE /admin/community/posts/{post_id}
# ========================================

@router.delete("/posts/{post_id}")
def delete_admin_community_post(
    post_id: int,
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    # 1. 삭제할 게시글 확인
    post = db.scalar(
        select(CommunityPost).where(
            CommunityPost.post_id == post_id
        )
    )

    if post is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="게시글을 찾을 수 없습니다.",
        )

    # 2. 게시글에 연결된 이미지 정보 조회
    images = (
        db.query(CommunityImage)
        .filter(CommunityImage.post_id == post_id)
        .all()
    )

    # 3. 서버의 이미지 업로드 폴더 경로
    back_dir = os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )

    upload_dir = os.path.realpath(
        os.path.join(back_dir, "uploads", "community")
    )

    # 4. 이미지 파일과 이미지 DB 정보 정리
    for image in images:
        stored_name = image.stored_name

        if not stored_name and image.file_path:
            stored_name = os.path.basename(
                image.file_path.replace("\\", "/")
            )

        if stored_name:
            file_path = os.path.realpath(
                os.path.join(upload_dir, stored_name)
            )

            # 업로드 폴더 내부의 파일인지 확인
            if (
                os.path.commonpath(
                    [upload_dir, file_path]
                ) == upload_dir
                and os.path.isfile(file_path)
            ):
                # 다른 게시글에서도 사용하는 이미지인지 확인
                other_image = (
                    db.query(CommunityImage)
                    .filter(
                        CommunityImage.stored_name == stored_name,
                        CommunityImage.image_id != image.image_id,
                        CommunityImage.post_id != post_id,
                    )
                    .first()
                )

                # 다른 게시글에서 사용하지 않을 때만 실제 파일 삭제
                if other_image is None:
                    os.remove(file_path)

        # 이미지 DB 정보 삭제
        db.delete(image)

    # 5. 게시글 삭제
    # post_reports는 ON DELETE SET NULL이므로 신고 기록은 유지됨
    db.delete(post)
    db.commit()

    return {
        "message": "게시글이 삭제되었습니다.",
        "post_id": post_id,
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
        .outerjoin(
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
                "title": title if title is not None else "[삭제된 게시글]",
                "reason": report.reason,
                "report_content": report.content,
                "nickname": nickname,
                "status": report.status,
                "reported_at": report.created_at,
                "reviewed_at": report.reviewed_at,
            }
            for report, title, nickname in rows
        ],
    }



# ========================================
# 관리자 신고 상태 변경
# PATCH /admin/community/reports/{report_id}/status
# ========================================

@router.patch("/reports/{report_id}/status")
def update_admin_report_status(
    report_id: int,
    new_status: Literal["REVIEWED", "ACCEPTED", "REJECTED"],
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    # 1. 신고 기록 조회
    report = db.scalar(
        select(PostReport).where(
            PostReport.report_id == report_id
        )
    )

    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="신고 기록을 찾을 수 없습니다.",
        )

    # 2. 신고 상태 변경
    report.status = new_status
    report.reviewed_at = datetime.now()

    # 3. 신고 승인이라면 해당 게시글 숨김 처리
    hidden_post_id = None

    if new_status == "ACCEPTED" and report.post_id is not None:
        post = db.scalar(
            select(CommunityPost).where(
                CommunityPost.post_id == report.post_id
            )
        )

        if post is not None:
            post.status = "HIDDEN"
            hidden_post_id = post.post_id

    # 4. 신고 상태와 게시글 상태를 함께 저장
    try:
        db.commit()
        db.refresh(report)
    except Exception:
        db.rollback()
        raise

    return {
        "message": "신고 상태가 변경되었습니다.",
        "report_id": report.report_id,
        "status": report.status,
        "reviewed_at": report.reviewed_at,
        "hidden_post_id": hidden_post_id,
        "post_status": "HIDDEN" if hidden_post_id is not None else None,
    }
