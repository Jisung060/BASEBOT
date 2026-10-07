from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session
from services.prediction_service import predictor

router = APIRouter(prefix="/api/predictions", tags=["predictions"])

# ----------------------------------------------------
# Pydantic Schemas
# ----------------------------------------------------
class VoteRequest(BaseModel):
    game_id: int
    user_id: int  # 로그인 연동 (세션/토큰 또는 테스트 user_id)
    selected_team_id: int
    bet_point: int = 100

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

# ----------------------------------------------------
# 1. 특정 경기의 투표 현황 및 유저 투표 여부 조회
# ----------------------------------------------------
@router.get("/votes/status")
def get_vote_status(
    game_id: int = Query(...),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_session)
):
    # 1) 경기 기본 정보 확인
    game = db.execute(
        text("SELECT game_id, home_team_id, away_team_id, status, home_score, away_score FROM games WHERE game_id = :gid"),
        {"gid": game_id}
    ).mappings().first()

    if not game:
        raise HTTPException(status_code=404, detail="경기를 찾을 수 없습니다.")

    # 2) 팀별 득표수 집계
    votes_query = text("""
        SELECT selected_team_id, COUNT(*) as vote_count
        FROM prediction_votes
        WHERE game_id = :gid
        GROUP BY selected_team_id
    """)
    vote_rows = db.execute(votes_query, {"gid": game_id}).mappings().all()

    vote_map = {r["selected_team_id"]: r["vote_count"] for r in vote_rows}
    home_votes = vote_map.get(game["home_team_id"], 0)
    away_votes = vote_map.get(game["away_team_id"], 0)
    total_votes = home_votes + away_votes

    home_pct = round((home_votes / total_votes * 100), 1) if total_votes > 0 else 50.0
    away_pct = round((away_votes / total_votes * 100), 1) if total_votes > 0 else 50.0

    # 3) 로그인 유저가 이미 투표했는지 확인
    my_vote = None
    if user_id:
        user_vote_row = db.execute(
            text("SELECT selected_team_id, bet_point, is_correct, reward_point FROM prediction_votes WHERE game_id = :gid AND user_id = :uid"),
            {"gid": game_id, "uid": user_id}
        ).mappings().first()
        if user_vote_row:
            my_vote = {
                "selected_team_id": user_vote_row["selected_team_id"],
                "bet_point": user_vote_row["bet_point"],
                "is_correct": user_vote_row["is_correct"],
                "reward_point": user_vote_row["reward_point"]
            }

    return {
        "game_id": game_id,
        "total_votes": total_votes,
        "home_votes": home_votes,
        "away_votes": away_votes,
        "home_vote_pct": home_pct,
        "away_vote_pct": away_pct,
        "my_vote": my_vote
    }

# ----------------------------------------------------
# 2. 투표 등록 (중복 투표 차단 및 DB 저장)
# ----------------------------------------------------
@router.post("/votes")
def cast_prediction_vote(
    vote: VoteRequest,
    db: Session = Depends(get_session)
):
    # 1) 경기 상태 검증 (이미 끝난 경기는 투표 불가)
    game = db.execute(
        text("SELECT status, home_team_id, away_team_id FROM games WHERE game_id = :gid"),
        {"gid": vote.game_id}
    ).mappings().first()

    if not game:
        raise HTTPException(status_code=404, detail="존재하지 않는 경기입니다.")
    if game["status"] == "FINAL":
        raise HTTPException(status_code=400, detail="이미 종료된 경기에는 투표할 수 없습니다.")
    if vote.selected_team_id not in (game["home_team_id"], game["away_team_id"]):
        raise HTTPException(status_code=400, detail="해당 경기에 참여하는 팀만 선택할 수 있습니다.")

    # 2) 중복 투표 검사
    existing = db.execute(
        text("SELECT vote_id FROM prediction_votes WHERE game_id = :gid AND user_id = :uid"),
        {"gid": vote.game_id, "uid": vote.user_id}
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="이미 이 경기에 투표하셨습니다. 중복 투표는 불가능합니다.")

    # 3) 유저 잔여 포인트 검사 및 차감 (users 테이블에 point 컬럼이 있는 경우 대응)
    user_row = db.execute(
        text("SELECT user_id, point FROM users WHERE user_id = :uid"),
        {"uid": vote.user_id}
    ).mappings().first()

    if not user_row:
        raise HTTPException(status_code=404, detail="유저 정보를 찾을 수 없습니다.")

    user_points = user_row.get("point", 1000)
    if user_points < vote.bet_point:
        raise HTTPException(status_code=400, detail="베팅 포인트가 부족합니다.")

    # 포인트 차감
    db.execute(
        text("UPDATE users SET point = point - :bet WHERE user_id = :uid"),
        {"bet": vote.bet_point, "uid": vote.user_id}
    )

    # 4) prediction_votes 테이블에 영구 INSERT
    db.execute(
        text("""
            INSERT INTO prediction_votes (game_id, user_id, selected_team_id, bet_point)
            VALUES (:gid, :uid, :tid, :bet)
        """),
        {"gid": vote.game_id, "uid": vote.user_id, "tid": vote.selected_team_id, "bet": vote.bet_point}
    )
    db.commit()

    return {"message": "투표가 성공적으로 등록되었습니다!", "bet_point": vote.bet_point}

# ----------------------------------------------------
# 3. 경기 종료 시 포인트 정산 (적중 여부 판정 및 지급)
# ----------------------------------------------------
@router.post("/settle/{game_id}")
def settle_game_votes(game_id: int, db: Session = Depends(get_session)):
    """
    경기가 FINAL이 되었을 때 호출하여 승자를 맞춘 유저에게 보상 지급
    (배당률: 2.0배 -> 100포인트 베팅 시 200포인트 적립)
    """
    game = db.execute(
        text("SELECT status, home_team_id, away_team_id, home_score, away_score FROM games WHERE game_id = :gid"),
        {"gid": game_id}
    ).mappings().first()

    if not game or game["status"] != "FINAL":
        raise HTTPException(status_code=400, detail="종료된 경기만 정산할 수 있습니다.")

    if game["home_score"] > game["away_score"]:
        winning_team_id = game["home_team_id"]
    elif game["away_score"] > game["home_score"]:
        winning_team_id = game["away_team_id"]
    else:
        winning_team_id = None  # 무승부

    # 아직 정산되지 않은 투표 내역 조회
    votes = db.execute(
        text("SELECT vote_id, user_id, selected_team_id, bet_point FROM prediction_votes WHERE game_id = :gid AND is_correct IS NULL"),
        {"gid": game_id}
    ).mappings().all()

    settled_count = 0
    for v in votes:
        is_hit = (v["selected_team_id"] == winning_team_id) if winning_team_id else False
        reward = v["bet_point"] * 2 if is_hit else 0

        # 투표 결과 기록
        db.execute(
            text("UPDATE prediction_votes SET is_correct = :hit, reward_point = :rew WHERE vote_id = :vid"),
            {"hit": is_hit, "rew": reward, "vid": v["vote_id"]}
        )

        # 적중 시 유저 포인트 적립
        if is_hit and reward > 0:
            db.execute(
                text("UPDATE users SET point = point + :rew WHERE user_id = :uid"),
                {"rew": reward, "uid": v["user_id"]}
            )
        settled_count += 1

    db.commit()
    return {"message": f"{settled_count}건의 투표가 정산 완료되었습니다.", "winning_team_id": winning_team_id}

# 내 포인트 조회 엔드포인트 추가
@router.get("/users/{user_id}/points")
def get_user_points(user_id: int, db: Session = Depends(get_session)):
    """로그인한 유저의 현재 보유 포인트 및 선호 구단 정보 조회"""
    user_row = db.execute(
        text("""
            SELECT user_id, username, point, favorite_team_id 
            FROM users 
            WHERE user_id = :uid
        """),
        {"uid": user_id}
    ).mappings().first()

    if not user_row:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")

    return {
        "user_id": user_row["user_id"],
        "username": user_row.get("username", "회원"),
        "point": user_row.get("point", 0),
        "favorite_team_id": user_row.get("favorite_team_id")
    }