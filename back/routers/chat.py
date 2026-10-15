from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database.db_connection import get_session
from schemas.chat import ChatRequest, ChatResponse
from services.chat_service import chat_with_ai
from auth.jwt import decode_access_token

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post("", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_session),
    authorization: str | None = Header(default=None)
):
    user_id = None

    # 로그인한 사용자라면 JWT 검증
    if authorization:
        if not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="유효하지 않은 인증 헤더입니다."
            )

        token = authorization.split(" ", 1)[1]
        payload = decode_access_token(token)

        user_id = payload.get("user_id")

        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="로그인 사용자 정보를 확인할 수 없습니다."
            )

    session_id, answer = chat_with_ai(
        question=request.message,
        db=db,
        session_id=request.session_id,
        user_id=user_id
    )

    return ChatResponse(
        session_id=session_id,
        answer=answer
    )