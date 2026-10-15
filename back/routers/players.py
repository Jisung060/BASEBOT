from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from database.db_connection import get_session

router = APIRouter(prefix="/api/players", tags=["players"])

def calculate_age(birth_date_str):
    if not birth_date_str:
        return "-"
    try:
        born = date.fromisoformat(str(birth_date_str)[:10])
        today = date.today()
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    except Exception:
        return "-"

@router.get("/search/autocomplete")
def search_players_and_teams(q: str = "", limit: int = 12, db: Session = Depends(get_session)):
    keyword = q.strip()
    if not keyword:
        return {"results": []}

    like_pattern = f"%{keyword}%"
    starts_pattern = f"{keyword}%"

    # 1. 구단 검색 (팀명, 약어, 연고지 매칭)
    team_sql = text("""
        SELECT team_id, team_name, team_code, league, division, logo_url
        FROM teams
        WHERE team_name LIKE :kw 
           OR team_code LIKE :kw 
           OR city LIKE :kw
        ORDER BY CASE WHEN team_name LIKE :starts THEN 0 ELSE 1 END, team_name ASC
        LIMIT 3
    """)
    teams = db.execute(team_sql, {"kw": like_pattern, "starts": starts_pattern}).mappings().all()

    # 2. 선수 검색 (최신 시즌 연도 및 소속팀 포함)
    player_sql = text("""
        SELECT 
            p.player_id,
            p.player_name,
            p.headshot_url,
            p.position,
            p.throws,
            t.team_name,
            t.team_code,
            (SELECT MAX(s.season) FROM player_season_stats s WHERE s.player_id = p.player_id) AS latest_season
        FROM players p
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE p.player_name LIKE :kw
           OR t.team_name LIKE :kw
           OR t.team_code LIKE :kw
        ORDER BY 
            CASE WHEN p.player_name LIKE :starts THEN 0 ELSE 1 END,
            p.player_name ASC
        LIMIT :limit
    """)
    players = db.execute(player_sql, {
        "kw": like_pattern,
        "starts": starts_pattern,
        "limit": limit
    }).mappings().all()

    results = []

    # 구단 결과 포맷팅
    for t in teams:
        results.append({
            "type": "team",
            "id": t["team_id"],
            "name": t["team_name"],
            "image_url": t["logo_url"] or f"https://www.mlbstatic.com/team-logos/{t['team_id']}.svg",
            "subtext": f"MLB | {t['league'] or ''} {t['division'] or ''} | {t['team_code'] or ''}"
        })

    # 선수 결과 포맷팅 (Baseball Savant 스타일: MLB | 2024 | RHP/RF | Yankees)
    for p in players:
        pos = p["position"] or "-"
        # 투수(P)인 경우 좌완(LHP)/우완(RHP)으로 Savant 스타일 표기
        if pos == "P" and p["throws"]:
            pos = f"{p['throws']}HP"

        season_str = str(p["latest_season"]) if p["latest_season"] else "2024"
        # 팀 이름에서 마지막 단어(예: New York Yankees -> Yankees) 추출해 깔끔하게 표시
        full_team = p["team_name"] or p["team_code"] or "FA"
        short_team = full_team.split()[-1] if full_team != "Boston Red Sox" and full_team != "Chicago White Sox" and full_team != "Toronto Blue Jays" else " ".join(full_team.split()[-2:])

        results.append({
            "type": "player",
            "id": p["player_id"],
            "name": p["player_name"],
            "image_url": p["headshot_url"] or "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/generic/headshot/67/current",
            "subtext": f"MLB | {season_str} | {pos} | {short_team}"
        })

    return {"results": results}

@router.get("/{player_id}")
def get_player_detail(player_id: int, db: Session = Depends(get_session)):
    # 1. 선수 기본 프로필 (현재 소속팀 포함)
    p_query = text("""
        SELECT 
            p.player_id, p.player_name, p.headshot_url, p.jersey_number,
            p.position, p.birth_date, p.bats, p.throws,
            p.team_id, t.team_name, t.team_code
        FROM players p
        LEFT JOIN teams t ON p.team_id = t.team_id
        WHERE p.player_id = :player_id
    """)
    player = db.execute(p_query, {"player_id": player_id}).mappings().first()
    if not player:
        raise HTTPException(status_code=404, detail="해당 선수를 찾을 수 없습니다.")

    # 2. 전시즌 타격/투구 통합 기록 조회 (해당 시즌 소속팀 정보 JOIN)
    s_query = text("""
        SELECT 
            s.*,
            COALESCE(st.team_id, p.team_id) AS season_team_id,
            COALESCE(st.team_name, pt.team_name) AS season_team_name,
            COALESCE(st.team_code, pt.team_code, 'MLB') AS season_team_code
        FROM player_season_stats s
        JOIN players p ON s.player_id = p.player_id
        LEFT JOIN teams st ON s.team_id = st.team_id
        LEFT JOIN teams pt ON p.team_id = pt.team_id
        WHERE s.player_id = :player_id
        ORDER BY s.season DESC
    """)
    all_stats = db.execute(s_query, {"player_id": player_id}).mappings().all()

    batting_stats = []
    pitching_stats = []
    seasons_set = set()

    for row in all_stats:
        item = dict(row)
        for k, v in item.items():
            if hasattr(v, "as_tuple"):  # Decimal -> float 변환
                item[k] = float(v)
        
        if item.get("season") is not None:
            seasons_set.add(int(item["season"]))

        if item.get("is_pitcher"):
            pitching_stats.append(item)
        else:
            batting_stats.append(item)

    available_seasons = sorted(list(seasons_set), reverse=True)

    # 기본 우선 탭 결정
    pos = str(player.get("position") or "").upper()
    if "P" in pos and pitching_stats:
        default_mode = "pitching"
    elif batting_stats:
        default_mode = "batting"
    elif pitching_stats:
        default_mode = "pitching"
    else:
        default_mode = "batting"

    return {
        "player_id": player["player_id"],
        "player_name": player["player_name"],
        "headshot_url": player["headshot_url"],
        "jersey_number": player["jersey_number"] or "-",
        "position": player["position"] or "-",
        "birth_date": str(player["birth_date"]) if player["birth_date"] else "-",
        "age": calculate_age(player["birth_date"]),
        "bats": player["bats"] or "-",
        "throws": player["throws"] or "-",
        "bt": f"{player['bats'] or '-'}/{player['throws'] or '-'}",
        "team_id": player["team_id"],
        "team_name": player["team_name"],
        "team_code": player["team_code"],
        "default_mode": default_mode,
        "available_seasons": available_seasons,
        "has_batting": len(batting_stats) > 0,
        "has_pitching": len(pitching_stats) > 0,
        "batting_stats": batting_stats,
        "pitching_stats": pitching_stats
    }