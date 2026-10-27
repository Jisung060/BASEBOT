from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_db
from routers.admin_users import get_admin_user

router = APIRouter(
    prefix="/api/admin/predictions",
    tags=["Admin Predictions"],
    dependencies=[Depends(get_admin_user)],
)


# =========================================================
# 1. 상단 KPI 요약 + 하이라이트 경기(최다 적중/최고 적중률) + 팀별 적중률 통계
# =========================================================
@router.get("/overview")
def get_admin_predictions_overview(db: Session = Depends(get_db)):
    # 1) 전체 요약 KPI
    kpi_sql = text("""
        SELECT 
            COUNT(*) AS total_votes,
            COUNT(DISTINCT user_id) AS unique_users,
            SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END) AS settled_votes,
            SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_votes,
            SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END) AS pending_votes,
            COALESCE(SUM(bet_point), 0) AS total_bet_points,
            COALESCE(SUM(reward_point), 0) AS total_reward_points
        FROM prediction_votes
    """)
    kpi = db.execute(kpi_sql).mappings().first() or {}

    total_votes = int(kpi.get("total_votes") or 0)
    settled_votes = int(kpi.get("settled_votes") or 0)
    correct_votes = int(kpi.get("correct_votes") or 0)
    overall_accuracy = round((correct_votes / settled_votes) * 100, 1) if settled_votes > 0 else 0.0

    # 2) 경기별 적중 통계 집계 (최다 적중 경기 / 최고 적중률 경기 / 최대 이변 경기 산출용)
    game_agg_sql = text("""
        SELECT 
            g.game_id,
            CAST(g.game_date AS CHAR) AS game_date,
            at.team_name AS away_team_name,
            at.team_code AS away_team_code,
            ht.team_name AS home_team_name,
            ht.team_code AS home_team_code,
            g.away_score,
            g.home_score,
            COUNT(v.vote_id) AS total_votes,
            SUM(CASE WHEN v.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS settled_votes,
            SUM(CASE WHEN v.is_correct = 1 THEN 1 ELSE 0 END) AS correct_votes
        FROM prediction_votes v
        JOIN games g ON v.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        GROUP BY g.game_id, g.game_date, at.team_name, at.team_code, ht.team_name, ht.team_code, g.away_score, g.home_score
        HAVING settled_votes > 0
    """)
    game_rows = db.execute(game_agg_sql).mappings().all()

    settled_games = []
    for r in game_rows:
        sv = int(r["settled_votes"] or 0)
        cv = int(r["correct_votes"] or 0)
        acc = round((cv / sv) * 100, 1) if sv > 0 else 0.0
        settled_games.append({
            "game_id": r["game_id"],
            "game_date": str(r["game_date"])[:10],
            "matchup": f"{r['away_team_name']} vs {r['home_team_name']}",
            "matchup_short": f"{r['away_team_code']} {r['away_score']} : {r['home_score']} {r['home_team_code']}",
            "total_votes": int(r["total_votes"] or 0),
            "settled_votes": sv,
            "correct_votes": cv,
            "accuracy": acc
        })

    # 최다 적중 경기 (correct_votes 기준 내림차순, 동률 시 total_votes 내림차순)
    most_hit_game = max(settled_games, key=lambda x: (x["correct_votes"], x["total_votes"])) if settled_games else None
    # 최고 적중률 경기 (accuracy 기준 내림차순, 동률 시 correct_votes 내림차순)
    highest_acc_game = max(settled_games, key=lambda x: (x["accuracy"], x["correct_votes"])) if settled_games else None
    # 최저 적중률(최대 이변) 경기 (accuracy 기준 오름차순, 동률 시 total_votes 내림차순)
    lowest_acc_game = min(settled_games, key=lambda x: (x["accuracy"], -x["total_votes"])) if settled_games else None

    # 3) 구단별 예측 적중률 통계 (유저들이 해당 팀을 승리팀으로 선택했을 때의 성적)
    team_stats_sql = text("""
        SELECT 
            t.team_id,
            t.team_name,
            t.team_code,
            t.league,
            t.division,
            COUNT(v.vote_id) AS vote_count,
            SUM(CASE WHEN v.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS settled_count,
            SUM(CASE WHEN v.is_correct = 1 THEN 1 ELSE 0 END) AS hit_count,
            SUM(CASE WHEN v.is_correct = 0 THEN 1 ELSE 0 END) AS miss_count,
            COALESCE(SUM(v.bet_point), 0) AS total_bet,
            COALESCE(SUM(v.reward_point), 0) AS total_reward
        FROM teams t
        LEFT JOIN prediction_votes v ON t.team_id = v.selected_team_id
        GROUP BY t.team_id, t.team_name, t.team_code, t.league, t.division
        HAVING vote_count > 0
        ORDER BY vote_count DESC
    """)
    team_rows = db.execute(team_stats_sql).mappings().all()

    team_accuracy_list = []
    for tr in team_rows:
        sc = int(tr["settled_count"] or 0)
        hc = int(tr["hit_count"] or 0)
        acc = round((hc / sc) * 100, 1) if sc > 0 else 0.0
        team_accuracy_list.append({
            "team_id": tr["team_id"],
            "team_name": tr["team_name"],
            "team_code": tr["team_code"],
            "division": f"{tr['league']} {tr['division']}",
            "vote_count": int(tr["vote_count"] or 0),
            "settled_count": sc,
            "hit_count": hc,
            "miss_count": int(tr["miss_count"] or 0),
            "accuracy": acc,
            "total_bet": int(tr["total_bet"] or 0),
            "total_reward": int(tr["total_reward"] or 0)
        })

    return {
        "kpi": {
            "total_votes": total_votes,
            "unique_users": int(kpi.get("unique_users") or 0),
            "settled_votes": settled_votes,
            "correct_votes": correct_votes,
            "pending_votes": int(kpi.get("pending_votes") or 0),
            "overall_accuracy": overall_accuracy,
            "total_bet_points": int(kpi.get("total_bet_points") or 0),
            "total_reward_points": int(kpi.get("total_reward_points") or 0)
        },
        "highlights": {
            "most_hit_game": most_hit_game,
            "highest_acc_game": highest_acc_game,
            "lowest_acc_game": lowest_acc_game
        },
        "team_stats": team_accuracy_list
    }


# =========================================================
# 2. 경기별 예측 현황 목록 조회
# =========================================================
@router.get("/games")
def get_admin_game_predictions(
    game_date: str = Query(""),
    status: str = Query(""),
    team: str = Query(""),
    only_voted: bool = Query(False, description="투표가 1건 이상 있는 경기만 보기"),
    limit: int = Query(150, ge=1, le=500),
    db: Session = Depends(get_db)
):
    where_clauses = ["1=1"]
    params = {"limit": limit}

    if game_date.strip():
        where_clauses.append("DATE(g.game_date) = :gdate")
        params["gdate"] = game_date.strip()

    if status.strip():
        where_clauses.append("g.status = :status")
        params["status"] = status.strip()

    if team.strip():
        where_clauses.append("(ht.team_name LIKE :kw OR at.team_name LIKE :kw OR ht.team_code LIKE :kw OR at.team_code LIKE :kw)")
        params["kw"] = f"%{team.strip()}%"

    having_clause = "HAVING total_votes > 0" if only_voted else ""

    sql = text(f"""
        SELECT 
            g.game_id,
            CAST(g.game_date AS CHAR) AS game_date,
            CAST(g.game_time AS CHAR) AS game_time,
            g.status,
            g.home_team_id,
            ht.team_name AS home_team_name,
            ht.team_code AS home_team_code,
            g.away_team_id,
            at.team_name AS away_team_name,
            at.team_code AS away_team_code,
            g.home_score,
            g.away_score,
            g.winning_team_id,
            wt.team_name AS winning_team_name,
            COUNT(v.vote_id) AS total_votes,
            SUM(CASE WHEN v.selected_team_id = g.home_team_id THEN 1 ELSE 0 END) AS home_votes,
            SUM(CASE WHEN v.selected_team_id = g.away_team_id THEN 1 ELSE 0 END) AS away_votes,
            COALESCE(SUM(CASE WHEN v.selected_team_id = g.home_team_id THEN v.bet_point ELSE 0 END), 0) AS home_bet_points,
            COALESCE(SUM(CASE WHEN v.selected_team_id = g.away_team_id THEN v.bet_point ELSE 0 END), 0) AS away_bet_points,
            SUM(CASE WHEN v.is_correct = 1 THEN 1 ELSE 0 END) AS correct_votes,
            SUM(CASE WHEN v.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS settled_votes,
            SUM(CASE WHEN v.is_correct IS NULL AND v.vote_id IS NOT NULL THEN 1 ELSE 0 END) AS unsettled_votes
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        LEFT JOIN teams wt ON g.winning_team_id = wt.team_id
        LEFT JOIN prediction_votes v ON g.game_id = v.game_id
        WHERE {" AND ".join(where_clauses)}
        GROUP BY 
            g.game_id, g.game_date, g.game_time, g.status,
            g.home_team_id, ht.team_name, ht.team_code,
            g.away_team_id, at.team_name, at.team_code,
            g.home_score, g.away_score, g.winning_team_id, wt.team_name
        {having_clause}
        ORDER BY total_votes DESC, g.game_date DESC, g.game_id DESC
        LIMIT :limit
    """)

    rows = db.execute(sql, params).mappings().all()
    items = []
    for r in rows:
        sv = int(r["settled_votes"] or 0)
        cv = int(r["correct_votes"] or 0)
        acc = round((cv / sv) * 100, 1) if sv > 0 else None

        winner_text = "미확정"
        if r["status"] == "FINAL":
            if r["winning_team_name"]:
                winner_text = f"{r['winning_team_name']} ({r['away_score']}:{r['home_score']})"
            elif r["home_score"] > r["away_score"]:
                winner_text = f"{r['home_team_name']} ({r['away_score']}:{r['home_score']})"
            elif r["away_score"] > r["home_score"]:
                winner_text = f"{r['away_team_name']} ({r['away_score']}:{r['home_score']})"
            else:
                winner_text = f"무승부 ({r['away_score']}:{r['home_score']})"
        elif r["status"] in ("IN_PROGRESS", "LIVE"):
            winner_text = f"진행중 ({r['away_score']}:{r['home_score']})"

        items.append({
            "game_id": r["game_id"],
            "game_date": str(r["game_date"])[:10] if r["game_date"] else "-",
            "matchup": f"{r['away_team_name']} vs {r['home_team_name']}",
            "status": r["status"],
            "game_result": winner_text,
            "total_votes": int(r["total_votes"] or 0),
            "home_votes": int(r["home_votes"] or 0),
            "away_votes": int(r["away_votes"] or 0),
            "home_bet_points": int(r["home_bet_points"] or 0),
            "away_bet_points": int(r["away_bet_points"] or 0),
            "correct_votes": cv,
            "accuracy": acc,
            "unsettled_votes": int(r["unsettled_votes"] or 0)
        })

    return {"games": items}


# =========================================================
# 3. 관리자 전용 사용자 상세 예측 랭킹
# =========================================================
@router.get("/user-rankings")
def get_admin_user_rankings(
    keyword: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db)
):
    where_clauses = ["1=1"]
    params = {"limit": limit}

    if keyword.strip():
        where_clauses.append("(u.username LIKE :kw OR u.nickname LIKE :kw OR u.email LIKE :kw)")
        params["kw"] = f"%{keyword.strip()}%"

    sql = text(f"""
        SELECT 
            u.user_id,
            u.username,
            u.nickname,
            u.grade,
            u.point AS current_point,
            u.prediction_streak,
            u.max_prediction_streak,
            t.team_code AS fav_team_code,
            COUNT(v.vote_id) AS total_votes,
            SUM(CASE WHEN v.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS settled_votes,
            SUM(CASE WHEN v.is_correct = 1 THEN 1 ELSE 0 END) AS correct_votes,
            SUM(CASE WHEN v.is_correct = 0 THEN 1 ELSE 0 END) AS failed_votes,
            SUM(CASE WHEN v.is_correct IS NULL AND v.vote_id IS NOT NULL THEN 1 ELSE 0 END) AS pending_votes,
            COALESCE(SUM(v.bet_point), 0) AS total_bet_points,
            COALESCE(SUM(v.reward_point), 0) AS total_reward_points
        FROM users u
        LEFT JOIN teams t ON u.favorite_team_id = t.team_id
        LEFT JOIN prediction_votes v ON u.user_id = v.user_id
        WHERE {" AND ".join(where_clauses)}
        GROUP BY 
            u.user_id, u.username, u.nickname, u.grade,
            u.point, u.prediction_streak, u.max_prediction_streak, t.team_code
        ORDER BY correct_votes DESC, total_reward_points DESC, u.point DESC
        LIMIT :limit
    """)

    rows = db.execute(sql, params).mappings().all()
    rankings = []
    for idx, r in enumerate(rows, start=1):
        sv = int(r["settled_votes"] or 0)
        cv = int(r["correct_votes"] or 0)
        acc = round((cv / sv) * 100, 1) if sv > 0 else 0.0
        tot_bet = int(r["total_bet_points"] or 0)
        tot_rew = int(r["total_reward_points"] or 0)

        rankings.append({
            "rank": idx,
            "user_id": r["user_id"],
            "username": r["username"],
            "nickname": r["nickname"] or r["username"],
            "grade": r["grade"] or "BRONZE",
            "fav_team_code": r["fav_team_code"] or "-",
            "current_point": int(r["current_point"] or 0),
            "total_votes": int(r["total_votes"] or 0),
            "settled_votes": sv,
            "correct_votes": cv,
            "failed_votes": int(r["failed_votes"] or 0),
            "pending_votes": int(r["pending_votes"] or 0),
            "accuracy": acc,
            "prediction_streak": int(r["prediction_streak"] or 0),
            "max_prediction_streak": int(r["max_prediction_streak"] or 0),
            "total_bet_points": tot_bet,
            "total_reward_points": tot_rew,
            "net_profit": tot_rew - tot_bet
        })

    return {"rankings": rankings}


# =========================================================
# 4. 사용자별 예측 상세 기록 조회
# =========================================================
@router.get("/records")
def get_admin_prediction_records(
    user: str = Query(""),
    game_date: str = Query(""),
    reward_status: str = Query(""),  # PAID(적중), FAILED(실패), PENDING(대기)
    limit: int = Query(150, ge=1, le=500),
    db: Session = Depends(get_db)
):
    where_clauses = ["1=1"]
    params = {"limit": limit}

    if user.strip():
        where_clauses.append("(u.username LIKE :ukw OR u.nickname LIKE :ukw)")
        params["ukw"] = f"%{user.strip()}%"

    if game_date.strip():
        where_clauses.append("DATE(g.game_date) = :gdate")
        params["gdate"] = game_date.strip()

    if reward_status == "PAID":
        where_clauses.append("v.is_correct = 1")
    elif reward_status == "FAILED":
        where_clauses.append("v.is_correct = 0")
    elif reward_status == "PENDING":
        where_clauses.append("v.is_correct IS NULL")

    sql = text(f"""
        SELECT 
            v.vote_id,
            v.user_id,
            u.username,
            u.nickname,
            v.game_id,
            CAST(g.game_date AS CHAR) AS game_date,
            g.status AS game_status,
            at.team_name AS away_team_name,
            ht.team_name AS home_team_name,
            g.away_score,
            g.home_score,
            st.team_name AS selected_team_name,
            wt.team_name AS winning_team_name,
            v.bet_point,
            v.reward_point,
            v.is_correct,
            CAST(v.created_at AS CHAR) AS voted_at,
            (SELECT COALESCE(SUM(v2.bet_point), 0) FROM prediction_votes v2 WHERE v2.user_id = v.user_id) AS user_total_bet
        FROM prediction_votes v
        JOIN users u ON v.user_id = u.user_id
        JOIN games g ON v.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        JOIN teams st ON v.selected_team_id = st.team_id
        LEFT JOIN teams wt ON g.winning_team_id = wt.team_id
        WHERE {" AND ".join(where_clauses)}
        ORDER BY v.vote_id DESC
        LIMIT :limit
    """)

    rows = db.execute(sql, params).mappings().all()
    records = []
    for r in rows:
        if r["is_correct"] == 1 or r["is_correct"] is True:
            status_code = "PAID"
            status_label = "적중 (지급완료)"
        elif r["is_correct"] == 0 or r["is_correct"] is False:
            status_code = "FAILED"
            status_label = "미적중 (0 P)"
        else:
            status_code = "PENDING"
            status_label = "정산 대기"

        if r["game_status"] == "FINAL":
            res_text = r["winning_team_name"] or (
                r["home_team_name"] if r["home_score"] > r["away_score"] else r["away_team_name"]
            )
            res_text = f"{res_text} 승 ({r['away_score']}:{r['home_score']})"
        elif r["game_status"] in ("IN_PROGRESS", "LIVE"):
            res_text = f"진행중 ({r['away_score']}:{r['home_score']})"
        else:
            res_text = "경기 예정"

        records.append({
            "vote_id": r["vote_id"],
            "user_id": r["user_id"],
            "user_display": f"{r['nickname'] or r['username']} ({r['username']})",
            "game_id": r["game_id"],
            "game_date": str(r["game_date"])[:10] if r["game_date"] else "-",
            "matchup": f"{r['away_team_name']} vs {r['home_team_name']}",
            "selected_team_name": r["selected_team_name"],
            "game_result": res_text,
            "bet_point": int(r["bet_point"] or 0),
            "user_total_bet": int(r["user_total_bet"] or 0),
            "reward_point": int(r["reward_point"] or 0),
            "status_code": status_code,
            "status_label": status_label,
            "voted_at": r["voted_at"] or "-"
        })

    return {"records": records}