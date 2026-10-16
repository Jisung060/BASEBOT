from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session

router = APIRouter(prefix="/api/standings", tags=["standings"])

DIVISION_ORDER = ["East", "Central", "West"]


@router.get("")
def get_standings(
    season: Optional[int] = Query(None, description="시즌 연도 (없으면 가장 최근 시즌)"),
    db: Session = Depends(get_session)
):
    """
    팀 순위 조회 API
    DB의 종료된 경기(games) 점수로 리그·지구별 승/패, 승률, 게임차, 연속, 최근 10경기를 계산한다.
    """
    # 1. 경기 결과가 있는 시즌 목록 (최신순)
    seasons = [
        row[0] for row in db.execute(text("""
            SELECT DISTINCT YEAR(game_date) AS season
            FROM games
            WHERE status = 'FINAL'
            ORDER BY season DESC
        """)).all()
    ]

    if season is None:
        season = seasons[0] if seasons else None

    # 2. 구단 목록
    teams = db.execute(text("""
        SELECT team_id, team_name, team_code, league, division, logo_url
        FROM teams
    """)).mappings().all()

    records = {
        team["team_id"]: {
            **team,
            "wins": 0, "losses": 0,
            "home_wins": 0, "home_losses": 0,
            "away_wins": 0, "away_losses": 0,
            "results": []                                  # 경기 순서대로 "W" / "L"
        }
        for team in teams
    }

    # 3. 해당 시즌 종료 경기를 날짜순으로 읽어 승패 누적
    games = db.execute(text("""
        SELECT home_team_id, away_team_id, home_score, away_score
        FROM games
        WHERE status = 'FINAL' AND YEAR(game_date) = :season
        ORDER BY game_date ASC
    """), {"season": season}).mappings().all() if season else []

    for game in games:
        home = records.get(game["home_team_id"])
        away = records.get(game["away_team_id"])
        if not home or not away or game["home_score"] == game["away_score"]:
            continue                                       # 모르는 구단이거나 무승부(서스펜디드 등)는 제외

        home_won = game["home_score"] > game["away_score"]
        winner, loser = (home, away) if home_won else (away, home)
        winner["wins"] += 1
        loser["losses"] += 1
        winner["results"].append("W")
        loser["results"].append("L")

        if home_won:
            home["home_wins"] += 1
            away["away_losses"] += 1
        else:
            away["away_wins"] += 1
            home["home_losses"] += 1

    # 4. 리그·지구별로 묶어 순위 계산
    divisions = []
    for league in ["AL", "NL"]:
        for division in DIVISION_ORDER:
            group = [r for r in records.values() if r["league"] == league and r["division"] == division]
            group.sort(key=lambda r: (-win_pct(r), -r["wins"], r["team_name"]))

            leader = group[0] if group else None
            rows = []
            for rank, r in enumerate(group, start=1):
                rows.append({
                    "rank": rank,
                    "team_id": r["team_id"],
                    "team_name": r["team_name"],
                    "team_code": r["team_code"],
                    "logo_url": r["logo_url"],
                    "games": r["wins"] + r["losses"],
                    "wins": r["wins"],
                    "losses": r["losses"],
                    "pct": round(win_pct(r), 3),
                    "games_behind": games_behind(leader, r),
                    "streak": streak(r["results"]),
                    "last10": last_ten(r["results"]),
                    "home": f"{r['home_wins']}-{r['home_losses']}",
                    "away": f"{r['away_wins']}-{r['away_losses']}"
                })

            divisions.append({"league": league, "division": division, "teams": rows})

    return {"season": season, "seasons": seasons, "divisions": divisions}


def win_pct(r):
    played = r["wins"] + r["losses"]
    return r["wins"] / played if played else 0


def games_behind(leader, r):
    # 게임차 = ((1위 승 - 내 승) + (내 패 - 1위 패)) / 2, 1위는 "-"
    if leader is None or leader["team_id"] == r["team_id"]:
        return "-"
    gb = ((leader["wins"] - r["wins"]) + (r["losses"] - leader["losses"])) / 2
    if gb == 0:
        return "-"
    return f"{gb:g}"                                       # 3.0 → "3", 2.5 → "2.5"


def streak(results):
    # 마지막 경기부터 같은 결과가 몇 번 이어졌는지 → "3연승" / "2연패"
    if not results:
        return "-"
    last = results[-1]
    count = 0
    for result in reversed(results):
        if result != last:
            break
        count += 1
    return f"{count}연{'승' if last == 'W' else '패'}"


def last_ten(results):
    recent = results[-10:]
    if not recent:
        return "-"
    wins = recent.count("W")
    return f"{wins}승 {len(recent) - wins}패"
