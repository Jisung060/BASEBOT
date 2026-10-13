from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_db

router = APIRouter(prefix="/api/rankings", tags=["Rankings"])

@router.get("")
def get_prediction_rankings(
    sort_by: str = Query("win_rate", description="정렬 기준: win_rate(승률), streak(현재연승), max_streak(최대연승), most_wins(최다적중), point(포인트)"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    승부예측 랭킹 리더보드 조회 API
    """
    # 1. 정렬 기준별 ORDER BY 및 WHERE 절 동적 구성
    min_games = 5  # 승률 체리피킹 방지용 최소 참여 경기 수
    
    if sort_by == "win_rate":
        # 승률 순: 최소 5회 이상 참여자 한정, 승률 동률 시 적중 수 많은 순
        where_clause = f"WHERE u.total_predictions >= {min_games}"
        order_clause = "ORDER BY win_rate DESC, u.correct_predictions DESC, u.total_predictions DESC"
    elif sort_by == "streak":
        # 현재 진행 중인 연승 순
        where_clause = "WHERE u.prediction_streak > 0"
        order_clause = "ORDER BY u.prediction_streak DESC, u.max_prediction_streak DESC"
    elif sort_by == "max_streak":
        # 역대 최대 연승 순
        where_clause = "WHERE u.max_prediction_streak > 0"
        order_clause = "ORDER BY u.max_prediction_streak DESC, u.correct_predictions DESC"
    elif sort_by == "most_wins":
        # 누적 적중 횟수 순
        where_clause = "WHERE u.correct_predictions > 0"
        order_clause = "ORDER BY u.correct_predictions DESC, win_rate DESC"
    elif sort_by == "point":
        # 보유 포인트 순
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
    """
    로그인한 유저 자신의 현재 순위 및 통계 요약 조회 API
    """
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

    # 승률 기준 전체 순위 계산
    rank_sql = text("""
        SELECT COUNT(*) + 1 AS my_rank
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
    rank_res = db.execute(rank_sql, {
        "win_rate": float(user["win_rate"]),
        "corrects": user["correct_predictions"]
    }).scalar()

    return {
        "status": "success",
        "user_info": dict(user),
        "win_rate_rank": rank_res if user["total_predictions"] >= 5 else None,
        "is_qualified": user["total_predictions"] >= 5
    }