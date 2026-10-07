from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    user_id: int | None = None

class ChatResponse(BaseModel):
    session_id: str | None = None
    answer: str

