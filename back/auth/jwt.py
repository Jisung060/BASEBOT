import jwt

from datetime import datetime, timedelta, timezone


SECRET_KEY = "basebot-secret-key"
ALGORITHM = "HS256"


# JWT 생성
def create_access_token(
        user_id: int,
        username: str
):
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1)
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )