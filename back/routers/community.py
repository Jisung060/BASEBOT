from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.community import CommunityPost
from models.user import User
from models.team import Team
from models.post_like import PostLike
from models.comment import Comment

from schemas.community import (
    CommunityPostCreate, CommunityPostUpdate )

router = APIRouter(
    prefix="/community",
    tags=["Community"]
)


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
    post: CommunityPostCreate,
    session: Session = Depends(get_session)
):
    related_team_id = None

    # 팀을 선택한 경우
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

    new_post = CommunityPost(
        user_id=1,
        category=post.category,
        related_team_id=related_team_id,
        title=post.title,
        content=post.content
    )

    session.add(new_post)
    session.commit()
    session.refresh(new_post)

    return new_post

@router.put("/posts/{post_id}")
def update_post(
    post_id: int,
    post: CommunityPostUpdate,
    session: Session = Depends(get_session)
):
    # 1. 수정할 게시글 찾기
    existing_post = (
        session.query(CommunityPost)
        .filter(
            CommunityPost.post_id == post_id
        )
        .first()
    )

    # 2. 게시글이 없는 경우
    if not existing_post:
        raise HTTPException(
            status_code=404,
            detail="게시글을 찾을 수 없습니다."
        )

    # 3. 관련 팀 찾기
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

    # 4. 게시글 내용 수정
    existing_post.category = post.category

    existing_post.related_team_id = (
        related_team_id
    )

    existing_post.title = post.title

    existing_post.content = post.content

    # 5. DB 저장
    session.commit()

    # 6. 최신 데이터 다시 가져오기
    session.refresh(existing_post)

    return existing_post

@router.delete("/posts/{post_id}")
def delete_post(
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
@router.post("/posts/{post_id}/like")
def toggle_post_like(
    post_id: int,
    session: Session = Depends(get_session)
):
    # 현재 로그인 사용자는 일단 테스트용으로 user_id=1 사용
    user_id = 1

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

    # 이미 좋아요를 눌렀다면 → 좋아요 취소
    if existing_like:
        session.delete(existing_like)

        if post.like_count > 0:
            post.like_count -= 1

        liked = False

    # 좋아요를 누르지 않았다면 → 좋아요 등록
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

# 좋아요 상태
@router.get("/posts/{post_id}/like")
def get_post_like(
    post_id: int,
    session: Session = Depends(get_session)
):
    # 현재 로그인 사용자는 일단 테스트용으로 user_id=1 사용
    user_id = 1

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

    # 현재 사용자가 좋아요를 눌렀는지 확인
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
    session: Session = Depends(get_session)
):
    # 현재 로그인 사용자는 테스트용으로 user_id=1 사용
    user_id = 1

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