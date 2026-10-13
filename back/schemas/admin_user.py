from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class AdminUserItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    username: str
    nickname: str
    email: EmailStr
    role: str
    grade: str
    status: str
    created_at: datetime


class AdminUserListResponse(BaseModel):
    total: int
    items: list[AdminUserItem]


class AdminUserDetailResponse(AdminUserItem):
    favorite_team_id: int | None
    point: int
    prediction_streak: int
    max_prediction_streak: int
    updated_at: datetime