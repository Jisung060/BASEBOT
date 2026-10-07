from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from services.prediction_service import predictor

router = APIRouter(prefix="/api/predictions", tags=["predictions"])

@router.get("/matchup")
def predict_teams_matchup(
    home_team_id: int = Query(..., description="홈팀 team_id"),
    away_team_id: int = Query(..., description="원정팀 team_id"),
    db: Session = Depends(get_session)
):
    """
    두 구단의 세이버메트릭스 지표 및 상대전적 기반 AI 승부예측
    """
    if home_team_id == away_team_id:
        raise HTTPException(status_code=400, detail="홈팀과 원정팀이 같을 수 없습니다.")

    # 1. 팀 기본 정보 조회 (이름, 코드, 로고)
    teams_query = text("""
        SELECT team_id, team_name, team_code, logo_url
        FROM teams
        WHERE team_id IN (:home_id, :away_id)
    """)
    team_rows = db.execute(teams_query, {"home_id": home_team_id, "away_id": away_team_id}).mappings().all()
    teams_dict = {t["team_id"]: t for t in team_rows}

    if home_team_id not in teams_dict or away_team_id not in teams_dict:
        raise HTTPException(status_code=404, detail="팀 정보를 찾을 수 없습니다.")

    # 2. 승부예측 및 상대전적 도출
    try:
        pred_res = predictor.predict_matchup(home_team_id, away_team_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 3. 팀 메타데이터 병합
    home_meta = teams_dict[home_team_id]
    away_meta = teams_dict[away_team_id]

    pred_res["home_team_name"] = home_meta["team_name"]
    pred_res["home_team_code"] = home_meta["team_code"]
    pred_res["home_logo_url"] = home_meta["logo_url"]

    pred_res["away_team_name"] = away_meta["team_name"]
    pred_res["away_team_code"] = away_meta["team_code"]
    pred_res["away_logo_url"] = away_meta["logo_url"]

    return pred_res