from fastapi import APIRouter, Depends

from sqlalchemy.orm import Session

from database.db_connection import get_session

from schemas.chat import (
    ChatRequest,
    ChatResponse
)

from services.chat_service import (
    chat_with_ai
)


router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)


@router.post(
    "",
    response_model=ChatResponse
)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_session)
):

    session_id, answer = chat_with_ai(
        question=request.message,
        db=db,
        session_id=request.session_id,
        user_id=request.user_id
    )


    return ChatResponse(
        session_id=session_id,
        answer=answer
    )