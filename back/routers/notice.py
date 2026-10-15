from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from auth.dependencies import get_current_user
from models.user import User

# =========================================
# 공지 작성/수정 요청 데이터
# =========================================
class NoticeRequest(BaseModel):
    category: str = Field(pattern="^(NOTICE|IMPORTANT|MAINTENANCE)$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    is_pinned: bool = False


def check_admin(user: User):
    # 화면에서 버튼을 숨기는 것과 별개로, 서버에서도 관리자인지 확인
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자만 이용할 수 있습니다.")


router = APIRouter(
    prefix="/api/notices",
    tags=["공지사항"],
)


# =========================================
# 공지사항 목록 조회
# - 상단 고정 공지 먼저, 그다음 최신순
# - keyword + search_type: title(제목) / title_content(제목+내용) / writer(작성자)
# - category: NOTICE(일반공지), IMPORTANT(중요공지), MAINTENANCE(점검)
# =========================================
@router.get("")
def get_notices(
        keyword: str | None = None,
        search_type: str = Query("title_content", pattern="^(title|title_content|writer)$"),
        category: str | None = Query(None, pattern="^(NOTICE|IMPORTANT|MAINTENANCE)$"),
        limit: int = Query(10, ge=1, le=100),
        db: Session = Depends(get_session)
):
    conditions = []
    params = {"limit": limit}

    if keyword:
        # 검색 기준에 따라 찾을 칸을 바꿈 (커뮤니티 검색과 동일)
        search_columns = {
            "title": "n.title LIKE :keyword",
            "title_content": "(n.title LIKE :keyword OR n.content LIKE :keyword)",
            "writer": "u.nickname LIKE :keyword",
        }
        conditions.append(search_columns[search_type])
        params["keyword"] = f"%{keyword}%"

    if category:
        conditions.append("n.category = :category")
        params["category"] = category

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = text(f"""
        SELECT
            n.notice_id,
            n.category,
            n.title,
            n.is_pinned,
            n.view_count,
            n.created_at,
            u.nickname AS writer
        FROM notice n
        LEFT JOIN users u ON u.user_id = n.admin_id
        {where}
        ORDER BY n.is_pinned DESC, n.created_at DESC, n.notice_id DESC
        LIMIT :limit
    """)

    rows = db.execute(sql, params).mappings().all()

    return {
        "notices": [
            {
                "notice_id": row["notice_id"],
                "category": row["category"],
                "title": row["title"],
                "is_pinned": bool(row["is_pinned"]),
                "view_count": row["view_count"],
                "created_at": row["created_at"],
                "writer": row["writer"]
            }
            for row in rows
        ]
    }


# =========================================
# 공지사항 상세 조회 (조회 수 +1)
# =========================================
@router.get("/{notice_id}")
def get_notice_detail(
        notice_id: int,
        increase_view: bool = True,   # 수정 화면에서 불러올 때는 false (조회 수 안 올림)
        db: Session = Depends(get_session)
):
    params = {"notice_id": notice_id}

    if increase_view:
        db.execute(
            text("UPDATE notice SET view_count = view_count + 1 WHERE notice_id = :notice_id"),
            params
        )
        db.commit()

    row = db.execute(text("""
        SELECT
            n.notice_id,
            n.category,
            n.title,
            n.content,
            n.is_pinned,
            n.view_count,
            n.created_at,
            n.updated_at,
            u.nickname AS writer
        FROM notice n
        LEFT JOIN users u ON u.user_id = n.admin_id
        WHERE n.notice_id = :notice_id
    """), params).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    return {
        "notice_id": row["notice_id"],
        "category": row["category"],
        "title": row["title"],
        "content": row["content"],
        "is_pinned": bool(row["is_pinned"]),
        "view_count": row["view_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "writer": row["writer"]
    }


# =========================================
# 공지사항 삭제 (관리자만 가능)
# =========================================
@router.delete("/{notice_id}")
def delete_notice(
        notice_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session)
):
    check_admin(current_user)

    result = db.execute(
        text("DELETE FROM notice WHERE notice_id = :notice_id"),
        {"notice_id": notice_id}
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    return {"message": "공지사항이 삭제되었습니다."}


# =========================================
# 공지사항 작성 (관리자만 가능)
# =========================================
@router.post("")
def create_notice(
        request: NoticeRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session)
):
    check_admin(current_user)

    result = db.execute(text("""
        INSERT INTO notice (admin_id, category, title, content, is_pinned)
        VALUES (:admin_id, :category, :title, :content, :is_pinned)
    """), {
        "admin_id": current_user.user_id,
        "category": request.category,
        "title": request.title.strip(),
        "content": request.content,
        "is_pinned": int(request.is_pinned)
    })
    db.commit()

    return {"notice_id": result.lastrowid, "message": "공지사항이 등록되었습니다."}


# =========================================
# 공지사항 수정 (관리자만 가능)
# =========================================
@router.put("/{notice_id}")
def update_notice(
        notice_id: int,
        request: NoticeRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session)
):
    check_admin(current_user)

    result = db.execute(text("""
        UPDATE notice
        SET category = :category, title = :title, content = :content, is_pinned = :is_pinned
        WHERE notice_id = :notice_id
    """), {
        "notice_id": notice_id,
        "category": request.category,
        "title": request.title.strip(),
        "content": request.content,
        "is_pinned": int(request.is_pinned)
    })
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다.")

    return {"notice_id": notice_id, "message": "공지사항이 수정되었습니다."}
