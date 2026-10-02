from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.db_connection import get_session

router = APIRouter(
    prefix="/users",
    tags=["Users"]
)


@router.get("/")
def get_users(db: Session = Depends(get_session)):
    return {"message": "회원 목록"}