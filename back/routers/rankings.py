from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_db

router = APIRouter(prefix="/api/rankings", tags=["Rankings"])

@router.get("")
def get_prediction_rankings(
    sort_by: str = Query("win_rate", description="정렬 기준: win_rate, streak, max_streak, most_wins, point"),
    limit: int = Query(10, ge=1, le=50),  # 기본 상위 10명으로 설정
    db: Session = Depends(get_db)
):
    min_games = 5
    
    if sort_by == "win_rate":
        where_clause = f"WHERE u.total_predictions >= {min_games}"
        order_clause = "ORDER BY win_rate DESC, u.correct_predictions DESC, u.total_predictions DESC"
    elif sort_by == "streak":
        where_clause = "WHERE u.prediction_streak > 0"
        order_clause = "ORDER BY u.prediction_streak DESC, u.max_prediction_streak DESC"
    elif sort_by == "max_streak":
        where_clause = "WHERE u.max_prediction_streak > 0"
        order_clause = "ORDER BY u.max_prediction_streak DESC, u.correct_predictions DESC"
    elif sort_by == "most_wins":
        where_clause = "WHERE u.correct_predictions > 0"
        order_clause = "ORDER BY u.correct_predictions DESC, win_rate DESC"
    elif sort_by == "point":
        where_clause = ""
        order_clause = "ORDER BY u.point DESC, u.correct_predictions DESC"
    else:
        raise HTTPException(status_code=400, detail="유효하지 않은 sort_by 파라미터입니다.")

    sql = text(f"""
        SELECT 
            u.user_id,
            u.nickname,
            u.grade,
            u.point,
            u.total_predictions,
            u.correct_predictions,
            u.prediction_streak,
            u.max_prediction_streak,
            CASE 
                WHEN u.total_predictions > 0 
                THEN ROUND((u.correct_predictions / u.total_predictions) * 100, 1)
                ELSE 0.0 
            END AS win_rate,
            t.team_name AS favorite_team_name,
            t.team_code AS favorite_team_code
        FROM users u
        LEFT JOIN teams t ON u.favorite_team_id = t.team_id
        {where_clause}
        {order_clause}
        LIMIT :limit
    """)

    results = db.execute(sql, {"limit": limit}).mappings().all()

    leaderboard = []
    for rank, row in enumerate(results, start=1):
        leaderboard.append({
            "rank": rank,
            "user_id": row["user_id"],
            "nickname": row["nickname"],
            "grade": row["grade"],
            "point": row["point"],
            "total_predictions": row["total_predictions"],
            "correct_predictions": row["correct_predictions"],
            "prediction_streak": row["prediction_streak"],
            "max_prediction_streak": row["max_prediction_streak"],
            "win_rate": float(row["win_rate"]),
            "favorite_team": {
                "name": row["favorite_team_name"],
                "code": row["favorite_team_code"]
            } if row["favorite_team_name"] else None
        })

    return {
        "status": "success",
        "sort_by": sort_by,
        "total_count": len(leaderboard),
        "data": leaderboard
    }


@router.get("/me")
def get_my_ranking(
    user_id: int = Query(..., description="조회할 유저 ID"),
    db: Session = Depends(get_db)
):
    sql = text("""
        SELECT 
            user_id,
            nickname,
            grade,
            point,
            total_predictions,
            correct_predictions,
            prediction_streak,
            max_prediction_streak,
            CASE 
                WHEN total_predictions > 0 
                THEN ROUND((correct_predictions / total_predictions) * 100, 1)
                ELSE 0.0 
            END AS win_rate
        FROM users
        WHERE user_id = :uid
    """)
    user = db.execute(sql, {"uid": user_id}).mappings().first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 1. 승률 순위 (최소 5경기 이상 참여자 기준)
    win_rate_rank = None
    if user["total_predictions"] >= 5:
        rank_sql = text("""
            SELECT COUNT(*) + 1 
            FROM users
            WHERE total_predictions >= 5 
              AND (
                  ROUND((correct_predictions / total_predictions) * 100, 1) > :win_rate
                  OR (
                      ROUND((correct_predictions / total_predictions) * 100, 1) = :win_rate 
                      AND correct_predictions > :corrects
                  )
              )
        """)
        win_rate_rank = db.execute(rank_sql, {
            "win_rate": float(user["win_rate"]),
            "corrects": user["correct_predictions"]
        }).scalar()

    # 2. 현재 연승 순위
    streak_rank = None
    if user["prediction_streak"] > 0:
        streak_rank = db.execute(text("""
            SELECT COUNT(*) + 1 
            FROM users 
            WHERE prediction_streak > :streak
               OR (prediction_streak = :streak AND max_prediction_streak > :max_streak)
        """), {
            "streak": user["prediction_streak"],
            "max_streak": user["max_prediction_streak"]
        }).scalar()

    # 3. 최대 연승 순위
    max_streak_rank = None
    if user["max_prediction_streak"] > 0:
        max_streak_rank = db.execute(text("""
            SELECT COUNT(*) + 1 
            FROM users 
            WHERE max_prediction_streak > :max_streak
               OR (max_prediction_streak = :max_streak AND correct_predictions > :corrects)
        """), {
            "max_streak": user["max_prediction_streak"],
            "corrects": user["correct_predictions"]
        }).scalar()

    # 4. 최다 적중 순위
    most_wins_rank = None
    if user["correct_predictions"] > 0:
        most_wins_rank = db.execute(text("""
            SELECT COUNT(*) + 1 
            FROM users 
            WHERE correct_predictions > :corrects
               OR (correct_predictions = :corrects AND (correct_predictions / GREATEST(total_predictions, 1)) > :rate)
        """), {
            "corrects": user["correct_predictions"],
            "rate": float(user["win_rate"])
        }).scalar()

    # 5. 보유 포인트 순위
    point_rank = db.execute(text("""
        SELECT COUNT(*) + 1 
        FROM users 
        WHERE point > :point
           OR (point = :point AND correct_predictions > :corrects)
    """), {
        "point": user["point"],
        "corrects": user["correct_predictions"]
    }).scalar()

    return {
        "status": "success",
        "user_info": dict(user),
        "ranks": {
            "win_rate": win_rate_rank,
            "streak": streak_rank,
            "max_streak": max_streak_rank,
            "most_wins": most_wins_rank,
            "point": point_rank
        },
        "is_qualified": user["total_predictions"] >= 5
    }