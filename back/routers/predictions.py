from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text, select, func, or_, and_, desc
from sqlalchemy.orm import Session, aliased

from database.db_connection import get_session, get_db
from routers.admin_users import get_admin_user
from services.prediction_service import predictor
from datetime import datetime, timedelta

from models.game import Game
from models.team import Team
from models.prediction_vote import PredictionVote

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
    season: Optional[int] = Query(None, description="분석 기준 시즌 연도"),
    db: Session = Depends(get_session)
):
    """
    두 구단의 확장 세이버메트릭스 지표(27종) 및 상대전적 기반 AI 승부예측
    """
    if home_team_id == away_team_id:
        raise HTTPException(status_code=400, detail="홈팀과 원정팀이 같을 수 없습니다.")

    teams_query = text("""
        SELECT team_id, team_name, team_code, logo_url
        FROM teams
        WHERE team_id IN (:home_id, :away_id)
    """)
    team_rows = db.execute(teams_query, {"home_id": home_team_id, "away_id": away_team_id}).mappings().all()
    teams_dict = {t["team_id"]: t for t in team_rows}

    if home_team_id not in teams_dict or away_team_id not in teams_dict:
        raise HTTPException(status_code=404, detail="팀 정보를 찾을 수 없습니다.")

    try:
        pred_res = predictor.predict_matchup(home_team_id, away_team_id, season=season)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
# 1. 특정 경기의 투표 현황 및 경기 상세 메타데이터 조회
# ----------------------------------------------------
@router.get("/votes/status")
def get_vote_status(
    game_id: int = Query(...),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_session)
):
    # 1) 경기 기본 정보 확인 (game_date, game_time, stadium, winning_team_id 모두 포함!)
    game = db.execute(
        text("""
            SELECT 
                game_id, home_team_id, away_team_id, status, 
                home_score, away_score, winning_team_id,
                CAST(game_date AS CHAR) AS game_date,
                CAST(game_time AS CHAR) AS game_time,
                stadium
            FROM games 
            WHERE game_id = :gid
        """),
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

    # 3) 로그인 유저 투표 여부 및 현재 연승(prediction_streak) 함께 조회
    my_vote = None
    if user_id:
        user_vote_row = db.execute(
            text("""
                SELECT v.selected_team_id, v.bet_point, v.is_correct, v.reward_point, u.prediction_streak
                FROM prediction_votes v
                JOIN users u ON v.user_id = u.user_id
                WHERE v.game_id = :gid AND v.user_id = :uid
            """),
            {"gid": game_id, "uid": user_id}
        ).mappings().first()
        if user_vote_row:
            my_vote = {
                "selected_team_id": user_vote_row["selected_team_id"],
                "bet_point": user_vote_row["bet_point"],
                "is_correct": user_vote_row["is_correct"],
                "reward_point": user_vote_row["reward_point"],
                "prediction_streak": user_vote_row["prediction_streak"]
            }

    return {
        "game_id": game_id,
        "game_info": {
            "status": game["status"],
            "home_score": game["home_score"],
            "away_score": game["away_score"],
            "winning_team_id": game["winning_team_id"],
            "game_date": game["game_date"],
            "game_time": game["game_time"],
            "stadium": game["stadium"]
        },
        "total_votes": total_votes,
        "home_votes": home_votes,
        "away_votes": away_votes,
        "home_vote_pct": home_pct,
        "away_vote_pct": away_pct,
        "my_vote": my_vote
    }


# ----------------------------------------------------
# 2. 투표 등록 (경기 시작 10분 전 마감 검증 포함)
# ----------------------------------------------------
@router.post("/votes")
def cast_prediction_vote(
    vote: VoteRequest,
    db: Session = Depends(get_session)
):
    # 1) 경기 상태 및 시작 시각 검증
    game = db.execute(
        text("""
            SELECT status, home_team_id, away_team_id,
                   CAST(game_date AS CHAR) AS game_date,
                   CAST(game_time AS CHAR) AS game_time
            FROM games 
            WHERE game_id = :gid
        """),
        {"gid": vote.game_id}
    ).mappings().first()

    if not game:
        raise HTTPException(status_code=404, detail="존재하지 않는 경기입니다.")
    if game["status"] != "SCHEDULED":
        raise HTTPException(status_code=400, detail="이미 시작되었거나 종료된 경기에는 투표할 수 없습니다.")
    if vote.selected_team_id not in (game["home_team_id"], game["away_team_id"]):
        raise HTTPException(status_code=400, detail="해당 경기에 참여하는 팀만 선택할 수 있습니다.")

    # ★ 경기 시작 10분 전 마감 체크 (UTC 저장 시각 -> KST 변환 후 현재 시각과 비교)
    if game["game_date"] and game["game_time"]:
        try:
            time_str = game["game_time"][:8]
            raw_dt = datetime.strptime(f"{game['game_date']} {time_str}", "%Y-%m-%d %H:%M:%S")
            # 999999 테스트 경기가 아닌 실제 MLB 경기는 UTC이므로 +9시간하여 KST로 변환
            if int(vote.game_id) != 999999:
                kst_start_dt = raw_dt + timedelta(hours=9)
            else:
                kst_start_dt = raw_dt

            deadline_dt = kst_start_dt - timedelta(minutes=10)
            if datetime.now() >= deadline_dt:
                raise HTTPException(status_code=400, detail="경기 시작 10분 전부터는 투표가 마감됩니다.")
        except ValueError:
            pass

    # 2) 중복 투표 검사
    existing = db.execute(
        text("SELECT vote_id FROM prediction_votes WHERE game_id = :gid AND user_id = :uid"),
        {"gid": vote.game_id, "uid": vote.user_id}
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="이미 이 경기에 투표하셨습니다. 중복 투표는 불가능합니다.")

    # 3) 유저 잔여 포인트 검사 및 차감
    user_row = db.execute(
        text("SELECT user_id, point FROM users WHERE user_id = :uid"),
        {"uid": vote.user_id}
    ).mappings().first()

    if not user_row:
        raise HTTPException(status_code=404, detail="유저 정보를 찾을 수 없습니다.")

    user_points = user_row.get("point", 1000)
    if user_points < vote.bet_point:
        raise HTTPException(status_code=400, detail="베팅 포인트가 부족합니다.")

    db.execute(
        text("UPDATE users SET point = point - :bet WHERE user_id = :uid"),
        {"bet": vote.bet_point, "uid": vote.user_id}
    )

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
@router.post("/settle/{game_id}", dependencies=[Depends(get_admin_user)])
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

    # Test APIs
class SettleGameRequest(BaseModel):
    game_id: int
    winning_team_id: int
    home_score: int = 5
    away_score: int = 3

@router.post("/test-settle")
def test_settle_game(
    req: SettleGameRequest,
    db: Session = Depends(get_db)
):
    """
    [테스트 전용] 특정 경기 결과 확정, 승패 판정 및 랭킹/연승 정확 반영
    """
    # 1. 대상 경기의 미판정(is_correct IS NULL) 투표 내역 조회
    sql_votes = text("""
        SELECT vote_id, user_id, selected_team_id, bet_point
        FROM prediction_votes
        WHERE game_id = :gid AND is_correct IS NULL
    """)
    votes = db.execute(sql_votes, {"gid": req.game_id}).mappings().all()

    # 2. games 테이블에 경기 결과(FINAL), 스코어, 승리팀 ID 반영
    db.execute(text("""
        UPDATE games
        SET status = 'FINAL',
            winning_team_id = :winner_id,
            home_score = :h_score,
            away_score = :a_score
        WHERE game_id = :gid
    """), {
        "winner_id": req.winning_team_id,
        "h_score": req.home_score,
        "a_score": req.away_score,
        "gid": req.game_id
    })

    settled_users = []

    for vote in votes:
        is_win = (int(vote["selected_team_id"]) == int(req.winning_team_id))
        reward = (vote["bet_point"] * 2) if is_win else 0

        # prediction_votes 결과 판정 기록
        db.execute(text("""
            UPDATE prediction_votes
            SET is_correct = :is_win,
                reward_point = :reward
            WHERE vote_id = :vid
        """), {
            "is_win": is_win,
            "reward": reward,
            "vid": vote["vote_id"]
        })

        # users 테이블 통계 반영 (연승 버그 완벽 수정)
        if is_win:
            db.execute(text("""
                UPDATE users
                SET total_predictions = total_predictions + 1,
                    correct_predictions = correct_predictions + 1,
                    point = point + :reward,
                    prediction_streak = prediction_streak + 1,
                    max_prediction_streak = GREATEST(max_prediction_streak, prediction_streak)
                WHERE user_id = :uid
            """), {
                "reward": reward,
                "uid": vote["user_id"]
            })
        else:
            db.execute(text("""
                UPDATE users
                SET total_predictions = total_predictions + 1,
                    prediction_streak = 0
                WHERE user_id = :uid
            """), {
                "uid": vote["user_id"]
            })

        settled_users.append({
            "user_id": vote["user_id"],
            "result": "WIN" if is_win else "LOSE",
            "reward": reward
        })

    db.commit()

    return {
        "status": "success",
        "message": f"경기({req.game_id}) 정상 정산 완료",
        "settled_count": len(settled_users),
        "details": settled_users
    }

class GameStatusSimulateRequest(BaseModel):
    game_id: int
    status: str = "FINAL"  # SCHEDULED, LIVE, FINAL
    winning_team_id: Optional[int] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None

@router.post("/test-settle-status")  # 또는 기존 엔드포인트명
def test_settle_game_status(
    req: GameStatusSimulateRequest,
    db: Session = Depends(get_db)
):
    """
    [테스트 전용] 경기 상태(SCHEDULED, LIVE, FINAL) 변경 및 경기 종료 시 자동 정산
    """
    # 0이나 유효하지 않은 ID가 들어오면 안전하게 None(NULL)으로 변환 (외래키 에러 방지)
    w_id = req.winning_team_id if req.winning_team_id and req.winning_team_id > 0 else None

    # 대상 경기 존재 여부 확인
    game = db.execute(
        text("SELECT game_id, home_team_id, away_team_id FROM games WHERE game_id = :gid"),
        {"gid": req.game_id}
    ).mappings().first()

    if not game:
        raise HTTPException(status_code=404, detail=f"game_id {req.game_id} 경기를 찾을 수 없습니다.")

    # 1. FINAL(종료) 상태일 때 처리
    if req.status == "FINAL":
        # winning_team_id가 안 넘어왔고 스코어가 넘어온 경우 스코어로 자동 판별
        if not w_id and req.home_score is not None and req.away_score is not None:
            if req.home_score > req.away_score:
                w_id = game["home_team_id"]
            elif req.away_score > req.home_score:
                w_id = game["away_team_id"]

        db.execute(text("""
            UPDATE games
            SET status = 'FINAL',
                winning_team_id = :winner_id,
                home_score = COALESCE(:h_score, home_score),
                away_score = COALESCE(:a_score, away_score)
            WHERE game_id = :gid
        """), {
            "winner_id": w_id,
            "h_score": req.home_score,
            "a_score": req.away_score,
            "gid": req.game_id
        })

        # 투표 판정 및 랭킹 정산 처리
        votes = db.execute(text("""
            SELECT vote_id, user_id, selected_team_id, bet_point
            FROM prediction_votes
            WHERE game_id = :gid AND is_correct IS NULL
        """), {"gid": req.game_id}).mappings().all()

        settled_users = []
        for vote in votes:
            is_win = (int(vote["selected_team_id"]) == int(w_id)) if w_id else False
            reward = (vote["bet_point"] * 2) if is_win else 0

            db.execute(text("""
                UPDATE prediction_votes
                SET is_correct = :is_win, reward_point = :reward
                WHERE vote_id = :vid
            """), {"is_win": is_win, "reward": reward, "vid": vote["vote_id"]})

            if is_win:
                db.execute(text("""
                    UPDATE users
                    SET total_predictions = total_predictions + 1,
                        correct_predictions = correct_predictions + 1,
                        point = point + :reward,
                        prediction_streak = prediction_streak + 1,
                        max_prediction_streak = GREATEST(max_prediction_streak, prediction_streak)
                    WHERE user_id = :uid
                """), {"reward": reward, "uid": vote["user_id"]})
            else:
                db.execute(text("""
                    UPDATE users
                    SET total_predictions = total_predictions + 1,
                        prediction_streak = 0
                    WHERE user_id = :uid
                """), {"uid": vote["user_id"]})

            settled_users.append({"user_id": vote["user_id"], "win": is_win, "reward": reward})

        db.commit()
        return {"status": "success", "game_status": "FINAL", "winning_team_id": w_id, "settled": settled_users}

    # 2. LIVE 또는 SCHEDULED 상태일 때 처리
    else:
        db.execute(text("""
            UPDATE games
            SET status = :status,
                winning_team_id = NULL,
                home_score = COALESCE(:h_score, 0),
                away_score = COALESCE(:a_score, 0)
            WHERE game_id = :gid
        """), {
            "status": req.status,
            "h_score": req.home_score,
            "a_score": req.away_score,
            "gid": req.game_id
        })
        db.commit()
        return {
            "status": "success",
            "game_status": req.status,
            "message": f"경기 상태가 {req.status}로 정상 변경되었습니다."
        }


# ------------------------------------
# main에 보일 경기 투표
# ------------------------------------
@router.get('/main')
def get_main_prediction_game(
    db: Session = Depends(get_session)
):
    # 홍팀과 원정팀을 각각 조회하기 위한 별칭
    HomeTeam = aliased(Team)
    AwayTeam = aliased(Team)

    # 경기별 예측 투표 수 집계
    vote_counts = (
        select(
            PredictionVote.game_id,
            func.count(PredictionVote.vote_id).label("vote_count")
        )
        .group_by(PredictionVote.game_id)
        .subquery()
    )

    # 현재 시각 이후에 시작하는 예정 경기 조회
    query = (
        select(
            Game.game_id,
            Game.game_date,
            Game.game_time,
            HomeTeam.team_id.label("home_team_id"),
            HomeTeam.team_name.label("home_team_name"),
            HomeTeam.logo_url.label("home_logo_url"),
            AwayTeam.team_id.label("away_team_id"),
            AwayTeam.team_name.label("away_team_name"),
            AwayTeam.logo_url.label("away_logo_url"),
            func.coalesce(
                vote_counts.c.vote_count, 0
            ).label("vote_count")
        )
        .join(
            HomeTeam,
            Game.home_team_id == HomeTeam.team_id
        )
        .join(
            AwayTeam,
            Game.away_team_id == AwayTeam.team_id
        )
        .outerjoin(
            vote_counts,
            Game.game_id == vote_counts.c.game_id
        )
        .where(
            Game.status == "SCHEDULED",
            Game.game_time.is_not(None),
            or_(
                Game.game_date > func.current_date(),
                and_(
                    Game.game_date == func.current_date(),
                    Game.game_time > func.current_time()
                )
            )
        )
        .order_by(
            desc("vote_count"),
            Game.game_date.asc(),
            Game.game_time.asc()
        )
        .limit(1)
    )

    game = db.execute(query).mappings().first()

    # 표시할 예정 경기가 없는 경우
    if game is None:
        return {"game": None}

    # 프론트엔드에서 사용하기 편한 JSON 형태로 반환
    return {
        "game": {
            "game_id": game["game_id"],
            "game_date": game["game_date"].isoformat(),
            "game_time": game["game_time"].isoformat(),
            "home_team": {
                "team_id": game["home_team_id"],
                "team_name": game["home_team_name"],
                "logo_url": game["home_logo_url"]
            },
            "away_team": {
                "team_id": game["away_team_id"],
                "team_name": game["away_team_name"],
                "logo_url": game["away_logo_url"]
            },
            "vote_count": game["vote_count"]
        }
    }