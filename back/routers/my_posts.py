from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from auth.jwt import decode_access_token


router = APIRouter(
    prefix="/mypage",
    tags=["마이페이지"],
)

security = HTTPBearer(auto_error=False)

# 로그인한 사용자 확인
def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> int:

    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="로그인이 필요합니다."
        )

    try:
        payload = decode_access_token(credentials.credentials)

        # JWT payload에서 user_id 추출
        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(
                status_code=401,
                detail="유효하지 않은 로그인 토큰입니다."
            )

        return int(user_id)

    except HTTPException:
        raise

    except (TypeError, ValueError, AttributeError):
        raise HTTPException(
            status_code=401,
            detail="로그인 토큰에서 사용자 정보를 확인할 수 없습니다."
        )

# 내가 쓴 글 조회
@router.get("/my-posts")
def get_my_posts(
    page: int = Query(0, ge=1),
    size: int = Query(5, ge=1, le=100),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    # 전체 게시글 수 : 로그읺한 사용자의 글만 계산
    count_sql = text(
        """
        SELECT COUNT(*)
        FROM community_posts
        where user_id = :user_id
            AND status = 'ACTIVE'
        """
    )

    total = db.execute(
        count_sql,
        {"user_id": user_id}
    ).scalar_one()

    # 페이지 계산
    total_pages = ceil(total / size) if total > 0 else 0
    offset = (page - 1) * size

    # 로그인한 상자의 게시글만 조회

    posts_sql = text(
        """
        SELECT post_id,
               user_id,
               category,
               related_team_id,
               title,
               content,
               view_count,
               like_count,
               comment_count,
               created_at,
               updated_at
        FROM community_posts
        WHERE user_id = :user_id
          AND status = 'ACTIVE'
        ORDER BY created_at DESC, post_id DESC LIMIT :size
        OFFSET :offset
        """
    )

    rows = db.execute(
        posts_sql,
        {
            "user_id": user_id,
            "size": size,
            "offset": offset
        }
    ).mappings().all()

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": size,
        "total_pages": total_pages
    }