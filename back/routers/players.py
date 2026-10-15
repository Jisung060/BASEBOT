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