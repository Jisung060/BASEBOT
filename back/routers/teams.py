from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter(prefix="/api/teams", tags=["teams"])

@router.get("/")
def get_all_teams(db: Session = Depends(get_db)):
    """회원가입 시 선호 구단 드롭다운 및 팀 목록 페이지용 API"""
    teams = db.query(models.Team).order_by(models.Team.league, models.Team.division, models.Team.team_name).all()
    return teams