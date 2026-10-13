from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from schemas.community import CommunityPostCreate, CommunityPostUpdate
from pydantic import BaseModel
import os
import re
from urllib.parse import urlparse
from database.db_connection import get_session



from models.community import CommunityPost
from models.user import User
from auth.dependencies import get_current_user
from models.team import Team
from models.post_like import PostLike
from models.comment import Comment
from models.comment_like import CommentLike
from models.community_image import CommunityImage
from models.post_scrap import PostScrap
from models.post_report import PostReport




router = APIRouter(
    prefix="/community",
    tags=["Community"]
)

# =========================================
# 게시글 신고 요청 데이터
# =========================================

class PostReportRequest(BaseModel):
    reason: str
    content: str | None = None

# =========================================
# 인기 게시글 조회
# =========================================

@router.get("/posts/popular")
def get_popular_posts(
    session: Session = Depends(get_session)
):
    posts = (
        session.query(
            CommunityPost,
            User.nickname,
            Team.team_name,
            Team.team_code,
            Team.league,
            Team.division
        )
        .join(
            User,
            CommunityPost.user_id == User.user_id
        )
        .outerjoin(
            Team,
            CommunityPost.related_team_id == Team.team_id
        )
        .order_by(
            CommunityPost.like_count.desc(),
            CommunityPost.view_count.desc(),
            CommunityPost.created_at.desc()
        )
        .limit(3)
        .all()
    )

    result = []

    for post, nickname, team_name, team_code, league, division in posts:

        result.append({
            "post_id": post.post_id,
            "user_id": post.user_id,
            "nickname": nickname,

            "category": post.category,

            "related_team_id": post.related_team_id,
            "team_name": team_name,
            "team_code": team_code,
            "league": league,
            "division": division,

            "title": post.title,
            "content": post.content,

            "view_count": post.view_count,
            "like_count": post.like_count,
            "comment_count": post.comment_count,

            "created_at": post.created_at
        })

    return result

@router.get("/posts")
def get_posts(
    session: Session = Depends(get_session)
):
    posts = (
        session.query(
            CommunityPost,
            User.nickname,
            Team.team_name,
            Team.team_code,
            Team.league,
            Team.division
        )
        .join(
            User,
            CommunityPost.user_id == User.user_id
        )
        .outerjoin(
            Team,
            CommunityPost.related_team_id == Team.team_id
        )
        .order_by(
            CommunityPost.created_at.desc()
        )
        .all()
    )

    result = []

    for post, nickname, team_name, team_code, league, division in posts:

        result.append({
            "post_id": post.post_id,
            "user_id": post.user_id,
            "nickname": nickname,

            "category": post.category,

            "related_team_id": post.related_team_id,
            "team_name": team_name,
            "team_code": team_code,
            "league": league,
            "division": division,

            "title": post.title,
            "content": post.content,

            "view_count": post.view_count,
            "like_count": post.like_count,
            "comment_count": post.comment_count,

            "created_at": post.created_at
        })

    return result

@router.post("/posts")
def create_post(
    post_data: CommunityPostCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    related_team_id = None

    # 팀을 선택한 경우
    if post_data.related_team_code:

        team = (
            session.query(Team)
            .filter(
                Team.team_code == post_data.related_team_code
            )
            .first()
        )

        if not team:
            raise HTTPException(
                status_code=404,
                detail="선택한 팀을 찾을 수 없습니다."
            )

        related_team_id = team.team_id

    new_post = CommunityPost(
        user_id=current_user.user_id,
        category=post_data.category,
        related_team_id=related_team_id,
        title=post_data.title,
        content=post_data.content
    )

    session.add(new_post)
    session.commit()
    session.refresh(new_post)

    # 게시글 본문에서 이미지 주소 추출
    import re
    import os
    from urllib.parse import urlparse

    image_urls = re.findall(
        r'<img[^>]+src=["\']([^"\']+)["\']',
        post_data.content,
        re.IGNORECASE
    )


    # 이미지 정보를 community_images 테이블에 저장
    for image_url in image_urls:
        parsed_url = urlparse(image_url)
        stored_name = os.path.basename(parsed_url.path)

        # 서버에 업로드된 이미지 주소인지 확인
        if not stored_name:
            continue

        if "/uploads/community/" not in parsed_url.path:
            continue

        file_path = os.path.join(
            "uploads",
            "community",
            stored_name
        )

        # 실제 서버 파일이 존재하는지 확인
        if not os.path.isfile(file_path):
            continue

        image_info = CommunityImage(
            post_id=new_post.post_id,
            original_name=stored_name,
            stored_name=stored_name,
            file_path=file_path,
            file_size=os.path.getsize(file_path)
        )

        session.add(image_info)

    session.commit()

    return new_post


# 게시글 수정
@router.put("/posts/{post_id}")
def update_post(
    post_id: int,
    post: CommunityPostUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 1. 수정할 게시글 찾기
    existing_post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not existing_post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 게시글 작성자 확인
    if existing_post.user_id != current_user.user_id:
        raise HTTPException(
            status_code=403,
            detail="본인이 작성한 게시글만 수정할 수 있습니다."
        )

    # 2. 관련 팀 찾기
    related_team_id = None

    if post.related_team_code:
        team = (
            session.query(Team)
            .filter(
                Team.team_code == post.related_team_code
            )
            .first()
        )

        if not team:
            raise HTTPException(
                status_code=404,
                detail="선택한 팀을 찾을 수 없습니다."
            )

        related_team_id = team.team_id

    # 3. 수정 후 본문에 남아 있는 이미지 파일명 추출
    image_urls = re.findall(
        r'<img[^>]+src=["\']([^"\']+)["\']',
        post.content or "",
        re.IGNORECASE
    )

    new_image_names = set()

    for image_url in image_urls:
        parsed_url = urlparse(image_url)

        # 서버 업로드 폴더의 이미지 주소만 처리
        if "/uploads/community/" not in parsed_url.path:
            continue

        stored_name = os.path.basename(
            parsed_url.path
        )

        if stored_name:
            new_image_names.add(stored_name)

    # 4. 기존 게시글의 이미지 정보 가져오기
    old_images = (
        session.query(CommunityImage)
        .filter(
            CommunityImage.post_id == post_id
        )
        .all()
    )

    # 5. 수정 후 본문에서 사라진 이미지 정리
    for image in old_images:
        old_name = image.stored_name

        if not old_name and image.file_path:
            old_name = os.path.basename(
                image.file_path.replace("\\", "/")
            )

        # 수정 후에도 본문에 남아 있으면 유지
        if old_name in new_image_names:
            continue

        # 실제 업로드 폴더 안의 파일인지 확인
        if old_name:
            upload_dir = os.path.realpath(
                os.path.join("uploads", "community")
            )

            file_path = os.path.realpath(
                os.path.join(upload_dir, old_name)
            )

            if (
                os.path.commonpath(
                    [upload_dir, file_path]
                ) == upload_dir
                and os.path.isfile(file_path)
            ):
                # 다른 이미지 정보에서도 사용 중인지 확인
                other_image = (
                    session.query(CommunityImage)
                    .filter(
                        CommunityImage.stored_name == old_name,
                        CommunityImage.image_id != image.image_id
                    )
                    .first()
                )

                if not other_image:
                    os.remove(file_path)

        # 이미지 DB 정보 삭제
        session.delete(image)

    # 6. 새로 추가된 이미지의 DB 정보 등록
    existing_names = {
        image.stored_name
        for image in old_images
        if image.stored_name
    }

    for stored_name in new_image_names:
        if stored_name in existing_names:
            continue

        upload_dir = os.path.realpath(
            os.path.join("uploads", "community")
        )

        file_path = os.path.realpath(
            os.path.join(upload_dir, stored_name)
        )

        if (
            os.path.commonpath(
                [upload_dir, file_path]
            ) != upload_dir
            or not os.path.isfile(file_path)
        ):
            continue

        image_info = CommunityImage(
            post_id=post_id,
            original_name=stored_name,
            stored_name=stored_name,
            file_path=os.path.join(
                "uploads",
                "community",
                stored_name
            ),
            file_size=os.path.getsize(file_path)
        )

        session.add(image_info)

    # 7. 게시글 내용 수정
    existing_post.category = post.category
    existing_post.related_team_id = related_team_id
    existing_post.title = post.title
    existing_post.content = post.content

    # 8. DB 저장
    session.commit()
    session.refresh(existing_post)

    return existing_post


# 게시글 삭제

@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 1. 삭제할 게시글 찾기
    post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )
    # 게시글 작성자 확인
    if post.user_id != current_user.user_id:
        raise HTTPException(
            status_code=403,
            detail="본인이 작성한 게시글만 삭제할 수 있습니다."
        )

    # 2. 게시글에 연결된 이미지 정보 가져오기
    images = (
        session.query(CommunityImage)
        .filter(
            CommunityImage.post_id == post_id
        )
        .all()
    )

    # 3. 실제 이미지 파일 삭제
    upload_dir = os.path.realpath(
        os.path.join("uploads", "community")
    )

    for image in images:
        stored_name = image.stored_name

        if not stored_name and image.file_path:
            stored_name = os.path.basename(
                image.file_path.replace("\\", "/")
            )

        if not stored_name:
            continue

        file_path = os.path.realpath(
            os.path.join(upload_dir, stored_name)
        )

        # 업로드 폴더 내부의 파일만 삭제
        if (
            os.path.commonpath(
                [upload_dir, file_path]
            ) == upload_dir
            and os.path.isfile(file_path)
        ):
            # 다른 게시글의 이미지 정보에서도 사용하는지 확인
            other_image = (
                session.query(CommunityImage)
                .filter(
                    CommunityImage.stored_name == stored_name,
                    CommunityImage.image_id != image.image_id
                )
                .first()
            )

            if not other_image:
                os.remove(file_path)

        # 4. 이미지 DB 정보 삭제
        session.delete(image)

    # 5. 게시글 삭제 및 DB 저장
    session.delete(post)
    session.commit()

    return {
        "message": "게시글이 삭제되었습니다.",
        "post_id": post_id
    }


# 게시글 상세 조회
@router.get("/posts/{post_id}")
def get_post(
        post_id: int,
        session: Session = Depends(get_session)
):
    post = (
        session.query(
            CommunityPost,
            User.nickname,
            Team.team_name,
            Team.team_code,
            Team.league,
            Team.division
        )
        .join(
            User,
            CommunityPost.user_id == User.user_id
        )
        .outerjoin(
            Team,
            CommunityPost.related_team_id == Team.team_id
        )
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    post, nickname, team_name, team_code, league, division = post

    return {
        "post_id": post.post_id,
        "user_id": post.user_id,
        "nickname": nickname,

        "category": post.category,

        "related_team_id": post.related_team_id,
        "team_name": team_name,
        "team_code": team_code,
        "league": league,
        "division": division,

        "title": post.title,
        "content": post.content,

        "view_count": post.view_count,
        "like_count": post.like_count,
        "comment_count": post.comment_count,

        "created_at": post.created_at,
        "updated_at": post.updated_at
    }

# 조회수
@router.post("/posts/{post_id}/view")
def increase_view_count(
    post_id: int,
    session: Session = Depends(get_session)
):
    post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    post.view_count += 1

    session.commit()
    session.refresh(post)

    return {
        "post_id": post.post_id,
        "view_count": post.view_count
    }

# 좋아요
# 게시글 좋아요 등록 / 취소
@router.post("/posts/{post_id}/like")
def toggle_post_like(
    post_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 실제 로그인한 사용자 ID
    user_id = current_user.user_id

    # 게시글 확인
    post = (
        session.query(CommunityPost)
        .filter(CommunityPost.post_id == post_id)
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 기존 좋아요 확인
    existing_like = (
        session.query(PostLike)
        .filter(
            PostLike.post_id == post_id,
            PostLike.user_id == user_id
        )
        .first()
    )

    # 이미 좋아요를 눌렀다면 취소
    if existing_like:
        session.delete(existing_like)

        if post.like_count > 0:
            post.like_count -= 1

        liked = False

    # 좋아요를 누르지 않았다면 등록
    else:
        new_like = PostLike(
            post_id=post_id,
            user_id=user_id
        )

        session.add(new_like)
        post.like_count += 1

        liked = True

    session.commit()
    session.refresh(post)

    return {
        "post_id": post_id,
        "liked": liked,
        "like_count": post.like_count
    }



# 게시글 좋아요 상태 조회
@router.get("/posts/{post_id}/like")
def get_post_like(
    post_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 실제 로그인한 사용자 ID
    user_id = current_user.user_id

    # 게시글 확인
    post = (
        session.query(CommunityPost)
        .filter(CommunityPost.post_id == post_id)
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 현재 로그인한 사용자의 좋아요 확인
    existing_like = (
        session.query(PostLike)
        .filter(
            PostLike.post_id == post_id,
            PostLike.user_id == user_id
        )
        .first()
    )

    return {
        "post_id": post_id,
        "liked": existing_like is not None,
        "like_count": post.like_count
    }


# 댓글 조회 API
@router.get("/posts/{post_id}/comments")
def get_comments(
    post_id: int,
    session: Session = Depends(get_session)
):
    comments = (
        session.query(Comment, User)
        .join(
            User,
            Comment.user_id == User.user_id
        )
        .filter(
            Comment.post_id == post_id
        )
        .order_by(
            Comment.created_at.asc()
        )
        .all()
    )

    return [
        {
            "comment_id": comment.comment_id,
            "post_id": comment.post_id,
            "user_id": comment.user_id,
            "nickname": user.nickname,
            "content": comment.content,
            "like_count": comment.like_count,
            "parent_comment_id": comment.parent_comment_id,
            "created_at": comment.created_at
        }
        for comment, user in comments
    ]

# 댓글 작성 API
@router.post("/posts/{post_id}/comments")
def create_comment(
    post_id: int,
    content: str,
    parent_comment_id: int | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    # 게시글 확인
    post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 부모 댓글 확인
    if parent_comment_id is not None:
        parent_comment = (
            session.query(Comment)
            .filter(
                Comment.comment_id == parent_comment_id,
                Comment.post_id == post_id
            )
            .first()
        )

        if not parent_comment:
            raise HTTPException(
                status_code=404,
                detail="답글을 작성할 댓글을 찾을 수 없습니다."
            )

    # 댓글 내용 확인
    if not content.strip():
        raise HTTPException(
            status_code=400,
            detail="댓글 내용을 입력해주세요."
        )

    # 댓글 생성
    new_comment = Comment(
        post_id=post_id,
        user_id=user_id,
        content=content.strip(),
        parent_comment_id=parent_comment_id
    )

    session.add(new_comment)

    # 게시글 댓글 수 증가
    post.comment_count += 1

    session.commit()
    session.refresh(new_comment)

    return {
        "comment_id": new_comment.comment_id,
        "post_id": new_comment.post_id,
        "user_id": new_comment.user_id,
        "content": new_comment.content,
        "parent_comment_id": new_comment.parent_comment_id,
        "like_count": new_comment.like_count,
        "comment_count": post.comment_count,
        "created_at": new_comment.created_at
    }

# =========================================
# 댓글 수정
# =========================================
@router.put("/comments/{comment_id}")
def update_comment(
    comment_id: int,
    content: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    # 댓글 확인
    comment = (
        session.query(Comment)
        .filter(
            Comment.comment_id == comment_id
        )
        .first()
    )

    if not comment:
        raise HTTPException(
            status_code=404,
            detail="댓글을 찾을 수 없습니다."
        )

    # 작성자 확인
    if comment.user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="댓글을 수정할 권한이 없습니다."
        )

    # 빈 댓글 확인
    if not content.strip():
        raise HTTPException(
            status_code=400,
            detail="댓글 내용을 입력해주세요."
        )

    # 댓글 내용 수정
    comment.content = content.strip()

    session.commit()
    session.refresh(comment)

    return {
        "comment_id": comment.comment_id,
        "content": comment.content,
        "updated_at": comment.updated_at
    }

# =========================================
# 댓글 삭제
# =========================================

@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    # 댓글 확인
    comment = (
        session.query(Comment)
        .filter(
            Comment.comment_id == comment_id
        )
        .first()
    )

    if not comment:
        raise HTTPException(
            status_code=404,
            detail="댓글을 찾을 수 없습니다."
        )

    # 작성자 확인
    if comment.user_id != user_id:
        raise HTTPException(
            status_code=403,
            detail="댓글을 삭제할 권한이 없습니다."
        )


    # 게시글 찾기
    post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == comment.post_id
        )
        .first()
    )

    # 삭제할 댓글과 그 아래에 연결된 모든 대댓글 찾기
    comment_rows = (
        session.query(
            Comment.comment_id,
            Comment.parent_comment_id
        )
        .filter(
            Comment.post_id == comment.post_id
        )
        .all()
    )

    # 처음에는 선택한 댓글만 삭제 대상에 포함
    deleted_comment_ids = {comment.comment_id}

    # 대댓글이 여러 단계로 연결되어 있어도 모두 찾기
    while True:
        previous_count = len(deleted_comment_ids)

        for row in comment_rows:
            if row.parent_comment_id in deleted_comment_ids:
                deleted_comment_ids.add(row.comment_id)

        # 더 이상 삭제 대상이 늘어나지 않으면 종료
        if len(deleted_comment_ids) == previous_count:
            break

    # 실제로 삭제될 댓글 수
    deleted_count = len(deleted_comment_ids)

    # 댓글 삭제
    session.delete(comment)

    # 게시글의 댓글 수를 실제 삭제 개수만큼 감소
    if post:
        post.comment_count = max(
            0,
            post.comment_count - deleted_count
        )

    session.commit()

    return {
        "comment_id": comment_id,
        "message": "댓글이 삭제되었습니다.",
        "comment_count": post.comment_count if post else 0
    }

# =========================================
# 댓글 좋아요 등록 / 취소
# =========================================

@router.post("/comments/{comment_id}/like")
def toggle_comment_like(
    comment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 실제 로그인한 사용자 ID
    user_id = current_user.user_id

    # 댓글 확인
    comment = (
        session.query(Comment)
        .filter(
            Comment.comment_id == comment_id
        )
        .first()
    )

    if not comment:
        raise HTTPException(
            status_code=404,
            detail="댓글을 찾을 수 없습니다."
        )

    # 기존 좋아요 확인
    existing_like = (
        session.query(CommentLike)
        .filter(
            CommentLike.comment_id == comment_id,
            CommentLike.user_id == user_id
        )
        .first()
    )

    # 이미 좋아요를 눌렀다면 취소
    if existing_like:
        session.delete(existing_like)

        if comment.like_count > 0:
            comment.like_count -= 1

        liked = False

    # 좋아요를 누르지 않았다면 등록
    else:
        new_like = CommentLike(
            comment_id=comment_id,
            user_id=user_id
        )

        session.add(new_like)
        comment.like_count += 1

        liked = True

    session.commit()
    session.refresh(comment)

    return {
        "comment_id": comment_id,
        "liked": liked,
        "like_count": comment.like_count
    }

# =========================================
# 댓글 좋아요 상태 조회
# =========================================

@router.get("/comments/{comment_id}/like")
def get_comment_like(
    comment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # 실제 로그인한 사용자 ID
    user_id = current_user.user_id

    # 댓글 확인
    comment = (
        session.query(Comment)
        .filter(
            Comment.comment_id == comment_id
        )
        .first()
    )

    if not comment:
        raise HTTPException(
            status_code=404,
            detail="댓글을 찾을 수 없습니다."
        )

    # 현재 로그인한 사용자의 좋아요 확인
    existing_like = (
        session.query(CommentLike)
        .filter(
            CommentLike.comment_id == comment_id,
            CommentLike.user_id == user_id
        )
        .first()
    )

    return {
        "comment_id": comment_id,
        "liked": existing_like is not None,
        "like_count": comment.like_count
    }


# =========================================
# 게시글 스크랩 상태 조회
# =========================================

@router.get("/posts/{post_id}/scrap")
def get_post_scrap(
    post_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    post = (
        session.query(CommunityPost)
        .filter(CommunityPost.post_id == post_id)
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    existing_scrap = (
        session.query(PostScrap)
        .filter(
            PostScrap.post_id == post_id,
            PostScrap.user_id == user_id
        )
        .first()
    )

    return {
        "post_id": post_id,
        "scrapped": existing_scrap is not None
    }


# =========================================
# 게시글 스크랩 등록 / 취소
# =========================================

@router.post("/posts/{post_id}/scrap")
def toggle_post_scrap(
    post_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    post = (
        session.query(CommunityPost)
        .filter(CommunityPost.post_id == post_id)
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    existing_scrap = (
        session.query(PostScrap)
        .filter(
            PostScrap.post_id == post_id,
            PostScrap.user_id == user_id
        )
        .first()
    )

    if existing_scrap:
        session.delete(existing_scrap)
        session.commit()

        return {
            "post_id": post_id,
            "scrapped": False,
            "message": "스크랩이 취소되었습니다."
        }

    new_scrap = PostScrap(
        post_id=post_id,
        user_id=user_id
    )

    session.add(new_scrap)
    session.commit()

    return {
        "post_id": post_id,
        "scrapped": True,
        "message": "게시글을 스크랩했습니다."
    }


# =========================================
# 게시글 신고 등록
# =========================================

@router.post("/posts/{post_id}/report")
def create_post_report(
    post_id: int,
    report_data: PostReportRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    user_id = current_user.user_id

    # 허용된 신고 사유인지 확인
    allowed_reasons = [
        "ABUSE",
        "AD",
        "SPAM",
        "INAPPROPRIATE",
        "ETC"
    ]

    if report_data.reason not in allowed_reasons:
        raise HTTPException(
            status_code=400,
            detail="올바른 신고 사유를 선택해주세요."
        )

    # 게시글 존재 여부 확인
    post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    if not post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 본인이 작성한 게시글은 신고할 수 없음
    if post.user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="본인이 작성한 게시글은 신고할 수 없습니다."
        )

    # 동일 사용자의 미처리 중복 신고 확인
    existing_report = (
        session.query(PostReport)
        .filter(
            PostReport.post_id == post_id,
            PostReport.user_id == user_id,
            PostReport.status == "PENDING"
        )
        .first()
    )

    if existing_report:
        raise HTTPException(
            status_code=409,
            detail="이미 신고한 게시글입니다."
        )

    # 신고 정보 생성
    new_report = PostReport(
        post_id=post_id,
        user_id=user_id,
        reason=report_data.reason,
        content=report_data.content
    )

    # DB 저장
    session.add(new_report)
    session.commit()
    session.refresh(new_report)

    return {
        "message": "신고가 접수되었습니다.",
        "report_id": new_report.report_id,
        "post_id": post_id,
        "reason": new_report.reason,
        "status": new_report.status
    }


# =========================================
# 게시글 이미지 업로드
# =========================================

@router.post("/images/upload")
def upload_community_image(
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    # 이미지 파일인지 확인
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="이미지 파일만 업로드할 수 있습니다."
        )

    # 파일 읽기
    file_data = file.file.read()

    # 파일 크기 확인
    file_size = len(file_data)

    # 업로드 폴더
    upload_dir = "uploads/community"

    import os
    import uuid

    # community.py가 있는 routers 폴더의 상위인 back 폴더
    BACK_DIR = os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )

    upload_dir = os.path.join(
        BACK_DIR,
        "uploads",
        "community"
    )

    # 폴더가 없으면 자동 생성
    os.makedirs(upload_dir, exist_ok=True)

    # 저장할 파일명 생성
    extension = os.path.splitext(file.filename or "")[1]

    stored_name = f"{uuid.uuid4().hex}{extension}"

    file_path = os.path.join(
        upload_dir,
        stored_name
    )

    # 실제 파일 저장
    with open(file_path, "wb") as image_file:
        image_file.write(file_data)

    return {
        "message": "이미지가 업로드되었습니다.",
        "original_name": file.filename,
        "stored_name": stored_name,
        "file_path": file_path,
        "file_size": file_size
    }