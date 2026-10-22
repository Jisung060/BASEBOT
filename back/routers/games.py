from typing import Optional
import json
import time as time_module   # get_games의 time 인자와 이름이 겹치지 않게
import requests
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

router = APIRouter(prefix="/api/games", tags=["games"])

@router.get("")
def get_games(
    game_id: Optional[int] = Query(None, description="경기 번호 (경기 상세에서 한 경기만 찾을 때)"),
    date: Optional[str] = Query(None, description="조회할 날짜 (YYYY-MM-DD 형식)"),
    time: Optional[str] = Query(None, description="경기 시간 24h(hh:mm:ss) 형식"),
    status: Optional[str] = Query(None, description="경기 상태 (FINAL, SCHEDULED 등)"),
    order: str = Query("desc", description="정렬 순서 (desc: 최신순, asc: 과거순)"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session)
):
    """
    날짜별 경기 일정 및 결과 조회 API (최신순 정렬 지원)
    """
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"

    query_str = f"""
        SELECT 
            g.game_id,
            g.game_date,
            CAST(g.game_time AS CHAR) AS game_time,
            DATE_FORMAT(g.game_date, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at,
            g.stadium AS venue_name,
            g.status,
            g.home_score,
            g.away_score,
            ht.team_id AS home_team_id,
            ht.team_name AS home_team_name,
            ht.team_code AS home_team_code,
            ht.logo_url AS home_logo_url,
            at.team_id AS away_team_id,
            at.team_name AS away_team_name,
            at.team_code AS away_team_code,
            at.logo_url AS away_logo_url
        FROM games g
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE 1=1
    """
    params = {"limit": limit}

    if game_id:
        query_str += " AND g.game_id = :game_id"
        params["game_id"] = game_id
    if date:
        query_str += " AND DATE(g.game_date) = :date"
        params["date"] = date
    if time:
        query_str += " AND TIME(g.game_time) = :time"
        params["time"] = time
    if status:
        query_str += " AND g.status = :status"
        params["status"] = status

    # 기존: query_str += " ORDER BY g.game_date ASC LIMIT :limit"
    # 수정: 최신 날짜 및 시간순으로 정렬 (game_date와 game_time이 분리되어 있다면 둘 다 DESC)
    query_str += " ORDER BY g.game_date DESC, g.game_time DESC LIMIT :limit"

    rows = db.execute(text(query_str), params).mappings().all()
    return rows

@router.get("/{game_id}/boxscore")
def get_game_boxscore(game_id: int):
    """
    특정 경기의 이닝별 라인스코어(Linescore) 및 팀별 R/H/E 박스스코어 조회
    """
    url = f"https://statsapi.mlb.com/api/v1/game/{game_id}/linescore"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="해당 경기의 박스스코어 정보를 찾을 수 없습니다.")
        resp.raise_for_status()
        data = resp.json()

        innings_data = []
        for inn in data.get("innings", []):
            innings_data.append({
                "num": inn.get("num"),
                "away_runs": inn.get("away", {}).get("runs", 0),
                "home_runs": inn.get("home", {}).get("runs", 0)
            })

        teams_data = data.get("teams", {})
        away_stats = teams_data.get("away", {})
        home_stats = teams_data.get("home", {})

        return {
            "game_id": game_id,
            "current_inning": data.get("currentInningOrdinal", "Final"),
            "innings": innings_data,
            "away_total": {
                "runs": away_stats.get("runs", 0),
                "hits": away_stats.get("hits", 0),
                "errors": away_stats.get("errors", 0)
            },
            "home_total": {
                "runs": home_stats.get("runs", 0),
                "hits": home_stats.get("hits", 0),
                "errors": home_stats.get("errors", 0)
            }
        }
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"MLB API 연동 오류: {str(e)}")


# ==========================================================
# ▼ [추가] 경기 상세 페이지 전용: DB에 저장된 이닝 점수 + 선수별 기록 (/api/games/{game_id}/detail)
#   - games.linescore(JSON) + game_boxscores + players(이름·사진)
#   - DB에 기록이 없으면 has_data=false → 프런트에서 MLB API로 대신 불러옴
# ==========================================================
@router.get("/{game_id}/detail")
def get_game_detail(game_id: int, db: Session = Depends(get_session)):
    game = db.execute(
        text("SELECT game_id, linescore FROM games WHERE game_id = :game_id"),
        {"game_id": game_id},
    ).mappings().first()
    if not game:
        raise HTTPException(status_code=404, detail="해당 경기를 DB에서 찾을 수 없습니다.")

    linescore = game["linescore"]
    if isinstance(linescore, str):                    # JSON 컬럼이 문자열로 오는 경우
        try:
            linescore = json.loads(linescore)
        except ValueError:
            linescore = None

    players = db.execute(text("""
        SELECT
            b.player_id, p.player_name, p.headshot_url, b.team_id,
            b.batting_order, b.position,
            b.at_bats, b.hits, b.home_runs, b.rbi, b.walks, b.strikeouts,
            b.innings_pitched, b.earned_runs, b.runs_allowed, b.hits_allowed,
            b.strikeouts_pitched, b.pitch_count,
            -- 이 경기 시즌의 누적 기록 (player_season_stats): 타자 타율·출루율·장타율·OPS, 투수 ERA·WHIP
            bat.batting_avg AS season_avg, bat.obp AS season_obp, bat.slg AS season_slg, bat.ops AS season_ops,
            pit.era AS season_era, pit.whip AS season_whip
        FROM game_boxscores b
        JOIN players p ON p.player_id = b.player_id
        JOIN games g ON g.game_id = b.game_id
        LEFT JOIN player_season_stats bat
            ON bat.player_id = b.player_id AND bat.season = YEAR(g.game_date) AND bat.is_pitcher = 0
        LEFT JOIN player_season_stats pit
            ON pit.player_id = b.player_id AND pit.season = YEAR(g.game_date) AND pit.is_pitcher = 1
        WHERE b.game_id = :game_id
        ORDER BY b.boxscore_id
    """), {"game_id": game_id}).mappings().all()

    return {
        "game_id": game_id,
        "has_data": bool(players),
        "linescore": linescore or [],
        "players": [
            {**row, "innings_pitched": float(row["innings_pitched"] or 0)}   # Decimal → 숫자
            for row in players
        ],
    }


# ==========================================================
# 경기 하이라이트 영상 (DB에 없어서 MLB 공식 API에서 받아 옴, 1시간 저장)
# ==========================================================
_highlight_cache = {}  # {game_id: (저장한 시각, 결과)}


@router.get("/{game_id}/highlights")
def get_game_highlights(game_id: int):
    cached = _highlight_cache.get(game_id)
    if cached and time_module.time() - cached[0] < 3600:
        return cached[1]

    try:
        response = requests.get(f"https://statsapi.mlb.com/api/v1/game/{game_id}/content", headers=HEADERS, timeout=10)
        response.raise_for_status()
        items = ((response.json().get("highlights") or {}).get("highlights") or {}).get("items") or []
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="하이라이트 영상을 불러오지 못했습니다.")

    # 경기 하이라이트(game-recap) 영상만 사용, 없으면 첫 영상 (개별 장면·인터뷰 등은 제외)
    recaps = [
        item for item in items
        if any(k.get("value") == "game-recap" for k in item.get("keywordsAll") or [])
    ]
    items = recaps[:1] or items[:1]

    videos = []
    for item in items:
        mp4 = next((p["url"] for p in item.get("playbacks", []) if p.get("name") == "mp4Avc"), None)
        if not mp4:
            continue
        cuts = (item.get("image") or {}).get("cuts") or []
        poster = next((c["src"] for c in cuts if c.get("width") == 640), cuts[0]["src"] if cuts else None)
        videos.append({
            "title": item.get("headline") or item.get("title"),
            "duration": item.get("duration"),
            "video_url": mp4,
            "image_url": poster,
        })

    result = {"game_id": game_id, "videos": videos}  # 경기 하이라이트 1개
    _highlight_cache[game_id] = (time_module.time(), result)
    return result


# ==========================================================
# ▼ [추가] 메인 페이지 "오늘의 경기" 전용 조회 라우터 (/api/games/main)
# ==========================================================
@router.get("/main")
def get_main_games(
    date: Optional[str] = Query(None, description="조회할 날짜 (YYYY-MM-DD)"),
    limit: int = Query(3, ge=1, le=10),
    db: Session = Depends(get_session)
):
    """
    메인 화면 오늘의 경기 카드 전용 (팀 풀네임 및 로고 URL 포함)
    """
    query_str = """
                SELECT g.game_id, \
                       CAST(g.game_date AS CHAR) AS game_date, \
                       CAST(g.game_time AS CHAR) AS game_time, \
                       g.status, \
                       g.home_score, \
                       g.away_score, \
                       ht.team_name              AS home_team_name, \
                       ht.team_code              AS home_team_code, \
                       ht.logo_url               AS home_logo_url, \
                       at.team_name              AS away_team_name, \
                       at.team_code              AS away_team_code, \
                       at.logo_url               AS away_logo_url
                FROM games g
                         JOIN teams ht ON g.home_team_id = ht.team_id
                         JOIN teams at \
                ON g.away_team_id = at.team_id
                WHERE g.status = 'SCHEDULED' \
                """

    params = {"limit": limit}

    if date:
        query_str += " AND DATE(g.game_date) = :date"
        params["date"] = date
    else:
        query_str += " AND DATE(g.game_date) >= CURDATE()"

    query_str += """
        ORDER BY g.game_date ASC, g.game_time ASC
        LIMIT :limit
    """

    rows = db.execute(text(query_str), params).mappings().all()
    return list(rows)