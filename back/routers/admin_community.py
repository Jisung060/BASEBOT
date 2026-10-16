import logging
import os
import re
import html

from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials

from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session, aliased

from pydantic import BaseModel

from auth.dependencies import bearer_scheme
from auth.jwt import decode_access_token
from database.db_connection import get_session

from models.user import User
from models.community import CommunityPost
from models.comment import Comment
from models.post_report import PostReport
from models.team import Team
from models.community_image import CommunityImage

from services.admin_activity_log_service import log_admin_activity


router = APIRouter(
    prefix="/admin/community",
    tags=["Admin - Community"],
)


# ========================================
# 관리자 커뮤니티 활동 로그
# ========================================

logger = logging.getLogger(__name__)


def record_community_activity(
    db: Session,
    admin: User,
    request: Request,
    *,
    action_detail: str,
    description: str,
    result: str,
    target_type: str,
    target_id: int | str | None = None,
    target_name: str | None = None,
    error_message: str | None = None,
):
    """
    관리자 커뮤니티 활동을 기존 활동 로그 테이블에 기록한다.

    활동 로그 저장 실패가 원래 작업의 응답을 방해하지 않도록
    로그 기록 과정의 예외를 별도로 처리한다.
    """
    try:
        log_admin_activity(
            db,
            admin_id=admin.user_id,
            admin_username=admin.username,
            action_type="COMMUNITY",
            action_detail=action_detail,
            description=description,
            result=result,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            error_message=error_message,
            request=request,
        )
    except Exception:
        logger.exception(
            "관리자 커뮤니티 활동 로그 저장 실패"
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
# 게시글 본문(HTML) → 태그 없는 미리보기 글자
# (화면에서는 textContent로만 출력하므로 안전하게 표시됨)
# ========================================

def make_excerpt(
    content: str | None,
    limit: int = 500,
) -> str:
    if not content:
        return ""

    text = re.sub(r"<[^>]+>", " ", content)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()

    # 글자 없이 이미지만 있는 게시글
    if not text and re.search(r"<img", content, re.IGNORECASE):
        return "[이미지]"

    if len(text) > limit:
        return text[:limit] + "…"

    return text


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
    # 이 글에 접수된 전체 신고 수
    report_count_query = (
        select(func.count(PostReport.report_id))
        .where(PostReport.post_id == CommunityPost.post_id)
        .correlate(CommunityPost)
        .scalar_subquery()
    )

    # 이 글에 대해 '승인'된 신고 수
    # 숨김 해제 안내에 사용
    accepted_report_count_query = (
        select(func.count(PostReport.report_id))
        .where(
            PostReport.post_id == CommunityPost.post_id,
            PostReport.status == "ACCEPTED",
        )
        .correlate(CommunityPost)
        .scalar_subquery()
    )

    query = (
        select(
            CommunityPost,
            User.nickname,
            report_count_query.label("report_count"),
            accepted_report_count_query.label(
                "accepted_report_count"
            ),
        )
        .join(
            User,
            CommunityPost.user_id == User.user_id,
        )
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
                "accepted_report_count": accepted_report_count,
                "status": post.status,
                "category": post.category,
                "comment_count": post.comment_count,
                "related_team_id": post.related_team_id,
            }
            for (
                post,
                nickname,
                report_count,
                accepted_report_count,
            ) in rows
        ],
    }


# ========================================
# 관리자 게시글 삭제
# DELETE /admin/community/posts/{post_id}
# ========================================

@router.delete("/posts/{post_id}")
def delete_admin_community_post(
    post_id: int,
    request: Request,
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

    # 삭제 후 로그에 사용할 게시글 제목 보관
    post_title = post.title

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

    try:
        db.commit()
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail="POST_DELETE",
            description=f"게시글 삭제 실패: {post_title}",
            result="FAILURE",
            target_type="POST",
            target_id=post_id,
            target_name=post_title,
            error_message=str(exc),
        )

        raise

    # 6. 게시글 삭제 성공 로그
    record_community_activity(
        db,
        admin,
        request,
        action_detail="POST_DELETE",
        description=f"게시글 삭제: {post_title}",
        result="SUCCESS",
        target_type="POST",
        target_id=post_id,
        target_name=post_title,
    )

    return {
        "message": "게시글이 삭제되었습니다.",
        "post_id": post_id,
    }


# ========================================
# 관리자 게시글 숨김 / 숨김 해제
# PATCH /admin/community/posts/{post_id}/status
# ========================================

@router.patch("/posts/{post_id}/status")
def update_admin_post_status(
    post_id: int,
    new_status: Literal["HIDDEN", "ACTIVE"],
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
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

    post_title = post.title

    post.status = new_status

    action_detail = (
        "POST_HIDE"
        if new_status == "HIDDEN"
        else "POST_UNHIDE"
    )

    try:
        db.commit()
        db.refresh(post)
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail=action_detail,
            description=f"게시글 상태 변경 실패: {post_title}",
            result="FAILURE",
            target_type="POST",
            target_id=post_id,
            target_name=post_title,
            error_message=str(exc),
        )

        raise

    record_community_activity(
        db,
        admin,
        request,
        action_detail=action_detail,
        description=(
            f"게시글 숨김 처리: {post_title}"
            if new_status == "HIDDEN"
            else f"게시글 숨김 해제: {post_title}"
        ),
        result="SUCCESS",
        target_type="POST",
        target_id=post_id,
        target_name=post_title,
    )

    return {
        "message": (
            "게시글이 숨김 처리되었습니다."
            if new_status == "HIDDEN"
            else "게시글 숨김이 해제되었습니다."
        ),
        "post_id": post.post_id,
        "status": post.status,
    }


# ========================================
# 수정 폼에 쓸 팀 목록
# GET /admin/community/teams
# ========================================

@router.get("/teams")
def get_admin_community_teams(
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    teams = db.scalars(
        select(Team).order_by(Team.team_name)
    ).all()

    return {
        "items": [
            {
                "team_id": team.team_id,
                "team_name": team.team_name,
            }
            for team in teams
        ]
    }


# ========================================
# 관리자 게시글 분류 정정
# 카테고리, 관련 팀만
# PATCH /admin/community/posts/{post_id}/classification
# ========================================

class PostClassificationBody(BaseModel):
    category: Literal[
        "GENERAL",
        "ANALYSIS",
        "GAME_THREAD",
        "NEWS",
    ]
    related_team_id: int | None = None


@router.patch("/posts/{post_id}/classification")
def update_admin_post_classification(
    post_id: int,
    body: PostClassificationBody,
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
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

    post_title = post.title
    old_category = post.category
    old_team_id = post.related_team_id

    # 팀을 지정했다면 존재하는 팀인지 확인
    if body.related_team_id is not None:
        team = db.scalar(
            select(Team).where(
                Team.team_id == body.related_team_id
            )
        )

        if team is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="선택한 팀을 찾을 수 없습니다.",
            )

    post.category = body.category
    post.related_team_id = body.related_team_id

    try:
        db.commit()
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail="POST_CLASSIFICATION_UPDATE",
            description=f"게시글 분류 수정 실패: {post_title}",
            result="FAILURE",
            target_type="POST",
            target_id=post_id,
            target_name=post_title,
            error_message=str(exc),
        )

        raise

    record_community_activity(
        db,
        admin,
        request,
        action_detail="POST_CLASSIFICATION_UPDATE",
        description=(
            f"게시글 분류 수정: {post_title}, "
            f"카테고리 {old_category} → {post.category}, "
            f"관련 팀 {old_team_id} → {post.related_team_id}"
        ),
        result="SUCCESS",
        target_type="POST",
        target_id=post_id,
        target_name=post_title,
    )

    return {
        "message": "분류가 수정되었습니다.",
        "post_id": post_id,
        "category": post.category,
        "related_team_id": post.related_team_id,
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
    # 이 댓글에 직접 달린 답글 수
    Reply = aliased(Comment)

    reply_count_query = (
        select(func.count(Reply.comment_id))
        .where(Reply.parent_comment_id == Comment.comment_id)
        .correlate(Comment)
        .scalar_subquery()
    )

    query = (
        select(
            Comment,
            User.nickname,
            CommunityPost.title.label("post_title"),
            reply_count_query.label("reply_count"),
        )
        .join(
            User,
            Comment.user_id == User.user_id,
        )
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
                "parent_comment_id": comment.parent_comment_id,
                "type": "comment",
                "title": post_title,
                "content": comment.content,
                "nickname": nickname,
                "created_at": comment.created_at,
                "report_count": 0,
                "reply_count": reply_count,
                "status": "ACTIVE",
            }
            for (
                comment,
                nickname,
                post_title,
                reply_count,
            ) in rows
        ],
    }


# ========================================
# 관리자 댓글 삭제
# 달린 답글도 함께 삭제
# DELETE /admin/community/comments/{comment_id}
# ========================================

@router.delete("/comments/{comment_id}")
def delete_admin_community_comment(
    comment_id: int,
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    # 1. 삭제할 댓글 확인
    comment = db.scalar(
        select(Comment).where(
            Comment.comment_id == comment_id
        )
    )

    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="댓글을 찾을 수 없습니다.",
        )

    # 삭제 후 로그에 사용할 정보 보관
    comment_content = make_excerpt(
        comment.content,
        limit=100,
    )
    comment_post_id = comment.post_id

    # 2. 삭제될 댓글 수 계산
    # 선택한 댓글 + 그 아래 모든 답글
    rows = db.execute(
        select(
            Comment.comment_id,
            Comment.parent_comment_id,
        ).where(
            Comment.post_id == comment.post_id
        )
    ).all()

    deleted_ids = {comment.comment_id}

    while True:
        before = len(deleted_ids)

        for row in rows:
            if row.parent_comment_id in deleted_ids:
                deleted_ids.add(row.comment_id)

        if len(deleted_ids) == before:
            break

    deleted_count = len(deleted_ids)

    # 3. 원글 확인
    # 숨김 상태여도 관리자는 삭제 가능
    post = db.scalar(
        select(CommunityPost).where(
            CommunityPost.post_id == comment.post_id
        )
    )

    # 4. 댓글 삭제
    # 답글은 DB의 ON DELETE CASCADE로 함께 삭제됨
    db.delete(comment)

    # 원글의 댓글 수를 실제 삭제된 개수만큼 감소
    if post is not None:
        post.comment_count = max(
            0,
            post.comment_count - deleted_count,
        )

    try:
        db.commit()
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail="COMMENT_DELETE",
            description=(
                f"댓글 삭제 실패: 댓글 ID {comment_id}, "
                f"함께 삭제될 댓글 수 {deleted_count}"
            ),
            result="FAILURE",
            target_type="COMMENT",
            target_id=comment_id,
            target_name=comment_content,
            error_message=str(exc),
        )

        raise

    record_community_activity(
        db,
        admin,
        request,
        action_detail="COMMENT_DELETE",
        description=(
            f"댓글 삭제: 댓글 ID {comment_id}, "
            f"게시글 ID {comment_post_id}, "
            f"삭제된 댓글 및 답글 {deleted_count}개"
        ),
        result="SUCCESS",
        target_type="COMMENT",
        target_id=comment_id,
        target_name=comment_content,
    )

    return {
        "message": "댓글이 삭제되었습니다.",
        "comment_id": comment_id,
        "deleted_count": deleted_count,
        "comment_count": post.comment_count if post else 0,
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

    # User는 신고자, PostAuthor는 게시글 작성자
    PostAuthor = aliased(User)

    query = (
        select(
            PostReport,
            CommunityPost.title,
            User.nickname,
            CommunityPost.content,
            CommunityPost.status,
            PostAuthor.nickname,
        )
        .outerjoin(
            CommunityPost,
            PostReport.post_id == CommunityPost.post_id,
        )
        .outerjoin(
            PostAuthor,
            CommunityPost.user_id == PostAuthor.user_id,
        )
        .join(
            User,
            PostReport.user_id == User.user_id,
        )
    )

    if report_status:
        query = query.where(
            PostReport.status == report_status
        )

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

    # 글별로 아직 처리되지 않은 신고 수
    # 검색 조건과 상관없이 전체 기준으로 계산
    open_counts = dict(
        db.execute(
            select(
                PostReport.post_id,
                func.count(PostReport.report_id),
            )
            .where(
                PostReport.post_id.is_not(None),
                PostReport.status.in_(
                    ["PENDING", "REVIEWED"]
                ),
            )
            .group_by(PostReport.post_id)
        ).all()
    )

    return {
        "total": len(rows),
        "pending_count": sum(
            1
            for row in rows
            if row[0].status == "PENDING"
        ),
        "items": [
            {
                "report_id": report.report_id,
                "post_id": report.post_id,
                "title": (
                    title
                    if title is not None
                    else "[삭제된 게시글]"
                ),
                "reason": report.reason,
                "report_content": report.content,
                "nickname": nickname,
                "status": report.status,
                "reported_at": report.created_at,
                "reviewed_at": report.reviewed_at,
                "post_excerpt": make_excerpt(post_content),
                "post_status": post_status,
                "post_author": post_author,
                "same_post_open_count": open_counts.get(
                    report.post_id,
                    0,
                ),
            }
            for (
                report,
                title,
                nickname,
                post_content,
                post_status,
                post_author,
            ) in rows
        ],
    }


# ========================================
# 상단 요약 카드
# GET /admin/community/summary
# 총계 + 오늘/어제 신규 건수
# ========================================

@router.get("/summary")
def get_admin_community_summary(
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    today_start = datetime.combine(
        date.today(),
        time.min,
    )
    yesterday_start = today_start - timedelta(days=1)

    def count(model, *conditions):
        query = select(func.count()).select_from(model)

        if conditions:
            query = query.where(*conditions)

        return db.scalar(query) or 0

    def build(model, date_column, *base):
        return {
            "total": count(model, *base),
            "today": count(
                model,
                *base,
                date_column >= today_start,
            ),
            "yesterday": count(
                model,
                *base,
                date_column >= yesterday_start,
                date_column < today_start,
            ),
        }

    open_statuses = ("PENDING", "REVIEWED")
    done_statuses = ("ACCEPTED", "REJECTED")

    return {
        "posts": build(
            CommunityPost,
            CommunityPost.created_at,
        ),
        "comments": build(
            Comment,
            Comment.created_at,
        ),

        # 신고 접수: 미처리 건수 / 접수일 기준 오늘·어제
        "reports": {
            "total": count(
                PostReport,
                PostReport.status.in_(open_statuses),
            ),
            "today": count(
                PostReport,
                PostReport.created_at >= today_start,
            ),
            "yesterday": count(
                PostReport,
                PostReport.created_at >= yesterday_start,
                PostReport.created_at < today_start,
            ),
        },

        # 처리 완료: 승인+반려 / 처리일 기준 오늘·어제
        "completed": build(
            PostReport,
            PostReport.reviewed_at,
            PostReport.status.in_(done_statuses),
        ),
    }


# ========================================
# 관리자 신고 상태 변경
# PATCH /admin/community/reports/{report_id}/status
# ========================================

@router.patch("/reports/{report_id}/status")
def update_admin_report_status(
    report_id: int,
    new_status: Literal[
        "REVIEWED",
        "ACCEPTED",
        "REJECTED",
    ],
    request: Request,
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

    # 로그 기록에 사용할 기존 정보 보관
    old_status = report.status
    report_post_id = report.post_id
    report_reason = report.reason

    # 같은 처리로 바뀌는 신고들은 같은 처리 시각을 사용
    now = datetime.now()

    # 2. 신고 상태 변경
    report.status = new_status
    report.reviewed_at = now

    hidden_post_id = None
    also_accepted_count = 0

    # 3. 신고 승인이라면 해당 게시글 숨김 처리
    if (
        new_status == "ACCEPTED"
        and report.post_id is not None
    ):
        post = db.scalar(
            select(CommunityPost).where(
                CommunityPost.post_id == report.post_id
            )
        )

        if post is not None:
            post.status = "HIDDEN"
            hidden_post_id = post.post_id

        # 4. 같은 글에 아직 처리되지 않은 다른 신고도 함께 승인
        other_reports = db.scalars(
            select(PostReport).where(
                PostReport.post_id == report.post_id,
                PostReport.report_id != report.report_id,
                PostReport.status.in_(
                    ["PENDING", "REVIEWED"]
                ),
            )
        ).all()

        for other in other_reports:
            other.status = "ACCEPTED"
            other.reviewed_at = now

        also_accepted_count = len(other_reports)

    # 5. 신고 상태와 게시글 상태를 함께 저장
    try:
        db.commit()
        db.refresh(report)
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail="REPORT_STATUS_UPDATE",
            description=(
                f"신고 상태 변경 실패: 신고 ID {report_id}, "
                f"{old_status} → {new_status}"
            ),
            result="FAILURE",
            target_type="REPORT",
            target_id=report_id,
            target_name=report_reason,
            error_message=str(exc),
        )

        raise

    record_community_activity(
        db,
        admin,
        request,
        action_detail="REPORT_STATUS_UPDATE",
        description=(
            f"신고 상태 변경: 신고 ID {report_id}, "
            f"{old_status} → {new_status}, "
            f"게시글 ID {report_post_id}, "
            f"함께 승인된 신고 {also_accepted_count}건"
        ),
        result="SUCCESS",
        target_type="REPORT",
        target_id=report_id,
        target_name=report_reason,
    )

    return {
        "message": "신고 상태가 변경되었습니다.",
        "report_id": report.report_id,
        "status": report.status,
        "reviewed_at": report.reviewed_at,
        "hidden_post_id": hidden_post_id,
        "post_status": (
            "HIDDEN"
            if hidden_post_id is not None
            else None
        ),
        "also_accepted_count": also_accepted_count,
    }


# ========================================
# 신고 처리 취소
# 승인/반려 → 대기
# PATCH /admin/community/reports/{report_id}/revert
# ========================================

@router.patch("/reports/{report_id}/revert")
def revert_admin_report(
    report_id: int,
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(get_admin_user),
):
    report = db.scalar(
        select(PostReport).where(
            PostReport.report_id == report_id
        )
    )

    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="신고를 찾을 수 없습니다.",
        )

    if report.status not in ("ACCEPTED", "REJECTED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="처리 완료된 신고만 취소할 수 있습니다.",
        )

    # 로그 기록에 사용할 기존 정보 보관
    old_status = report.status
    report_post_id = report.post_id
    report_reason = report.reason

    reverted_count = 0
    post_restored = False

    if report.status == "REJECTED":
        # 반려 취소: 이 신고만 대기로 복귀
        report.status = "PENDING"
        report.reviewed_at = None
        reverted_count = 1

    else:
        # 승인 취소: 글 상태 확인
        post = (
            db.scalar(
                select(CommunityPost).where(
                    CommunityPost.post_id == report.post_id
                )
            )
            if report.post_id is not None
            else None
        )

        if post is None or post.status == "DELETED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="삭제된 게시글의 승인은 취소할 수 없습니다.",
            )

        # 같은 글에서 승인된 신고를 모두 대기로 복귀
        accepted_reports = db.scalars(
            select(PostReport).where(
                PostReport.post_id == report.post_id,
                PostReport.status == "ACCEPTED",
            )
        ).all()

        for item in accepted_reports:
            item.status = "PENDING"
            item.reviewed_at = None

        reverted_count = len(accepted_reports)

        # 숨김 상태였다면 다시 공개
        if post.status == "HIDDEN":
            post.status = "ACTIVE"
            post_restored = True

    try:
        db.commit()
    except Exception as exc:
        db.rollback()

        record_community_activity(
            db,
            admin,
            request,
            action_detail="REPORT_REVERT",
            description=(
                f"신고 처리 취소 실패: 신고 ID {report_id}, "
                f"기존 상태 {old_status}"
            ),
            result="FAILURE",
            target_type="REPORT",
            target_id=report_id,
            target_name=report_reason,
            error_message=str(exc),
        )

        raise

    record_community_activity(
        db,
        admin,
        request,
        action_detail="REPORT_REVERT",
        description=(
            f"신고 처리 취소: 신고 ID {report_id}, "
            f"기존 상태 {old_status} → PENDING, "
            f"게시글 ID {report_post_id}, "
            f"되돌린 신고 {reverted_count}건, "
            f"게시글 공개 복구 여부 {post_restored}"
        ),
        result="SUCCESS",
        target_type="REPORT",
        target_id=report_id,
        target_name=report_reason,
    )

    return {
        "message": "처리가 취소되었습니다.",
        "report_id": report_id,
        "reverted_count": reverted_count,
        "post_restored": post_restored,
    }