from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    username: str
    password: str
    nickname: str
    email: EmailStr
    favorite_team_id: int | None = None


class SignupResponse(BaseModel):
    user_id: int
    username: str
    nickname: str
    email: EmailStr
    favorite_team_id: int | None

class UsernameCheckResponse(BaseModel):
    available: bool
    message: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    username: str
    nickname: str