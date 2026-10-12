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
    # 1. 선수 프로필
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

    # 2. 전시즌 타격/투구 통합 기록 조회
    s_query = text("""
        SELECT *
        FROM player_season_stats
        WHERE player_id = :player_id
        ORDER BY season DESC
    """)
    all_stats = db.execute(s_query, {"player_id": player_id}).mappings().all()

    batting_stats = []
    pitching_stats = []

    for row in all_stats:
        item = dict(row)
        for k, v in item.items():
            if hasattr(v, "as_tuple"):  # Decimal -> float 변환
                item[k] = float(v)
        
        if item.get("is_pitcher"):
            pitching_stats.append(item)
        else:
            batting_stats.append(item)

    # 기본 우선 탭 결정 (포지션이 P이거나 투구 기록만 있는 경우 PITCHING 우선)
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
        "has_batting": len(batting_stats) > 0,
        "has_pitching": len(pitching_stats) > 0,
        "batting_stats": batting_stats,
        "pitching_stats": pitching_stats
    }