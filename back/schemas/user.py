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

class FindIdRequest(BaseModel):
    nickname: str
    email: EmailStr

class FindIdResponse(BaseModel):
    username: str

# 비밀번호 변경 회원 확인
class PasswordResetVerifyRequest(BaseModel):
    username: str
    email: EmailStr

class PasswordResetVerifyResponse(BaseModel):
    verified: bool

# 비밀번호 변경
class PasswordResetRequest(BaseModel):
    username: str
    email: EmailStr
    new_password: str

class PasswordResetResponse(BaseModel):
    message: str