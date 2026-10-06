from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.db_connection import get_session
from models.community import CommunityPost
from models.user import User
from models.team import Team
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

