
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import get_session


router = APIRouter(prefix="/api/standings", tags=["standings"])

DIVISION_ORDER = ["East", "Central", "West"]
WILDCARD_SPOTS = 3  # 리그별 와일드카드 진출 팀 수


@router.get("")
def get_standings(
    season: Optional[int] = Query(None, description="시즌 연도 (없으면 가장 최근 시즌)"),
    db: Session = Depends(get_session)
):
    """
    팀 순위 조회 API

    DB의 종료된 경기(games) 점수로 리그·지구별 승/패, 승률,
    게임차, 연속, 최근 10경기를 계산한다.
    """

    # 1. 경기 결과가 있는 시즌 목록 (최신순)
    seasons = [
        row[0]
        for row in db.execute(text("""
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
            "wins": 0,
            "losses": 0,
            "results": []  # 경기 순서대로 "W" / "L"
        }
        for team in teams
    }

    # 팀 타율·평균자책 (박스스코어를 수집한 경기만 반영)
    # 이닝 5.1 = 5⅓이닝이므로 아웃카운트(정수 × 3 + 소수점 숫자)로 바꿔서 합산
    team_stats = {
        row["team_id"]: row
        for row in db.execute(text("""
            SELECT
                b.team_id,
                SUM(b.hits) AS hits,
                SUM(b.at_bats) AS at_bats,
                SUM(b.earned_runs) AS earned_runs,
                SUM(
                    FLOOR(b.innings_pitched) * 3
                    + ROUND(
                        (b.innings_pitched - FLOOR(b.innings_pitched)) * 10
                    )
                ) AS outs
            FROM game_boxscores b
            JOIN games g ON g.game_id = b.game_id
            WHERE g.status = 'FINAL'
              AND YEAR(g.game_date) = :season
            GROUP BY b.team_id
        """), {"season": season}).mappings().all()
    } if season else {}

    # 3. 해당 시즌 종료 경기를 날짜순으로 읽어 승패 누적
    games = db.execute(text("""
        SELECT
            home_team_id,
            away_team_id,
            home_score,
            away_score
        FROM games
        WHERE status = 'FINAL'
          AND YEAR(game_date) = :season
        ORDER BY game_date ASC, game_time ASC, game_id ASC
    """), {"season": season}).mappings().all() if season else []

    for game in games:
        home = records.get(game["home_team_id"])
        away = records.get(game["away_team_id"])

        if (
            not home
            or not away
            or game["home_score"] == game["away_score"]
        ):
            continue  # 모르는 구단이거나 무승부(서스펜디드 등)는 제외

        home_won = game["home_score"] > game["away_score"]
        winner, loser = (home, away) if home_won else (away, home)

        winner["wins"] += 1
        loser["losses"] += 1

        winner["results"].append("W")
        loser["results"].append("L")

    def make_row(rank, r, gb, playoff):
        """표 한 줄에 들어갈 값"""

        return {
            "rank": rank,
            "team_id": r["team_id"],
            "team_name": r["team_name"],
            "team_code": r["team_code"],
            "logo_url": r["logo_url"],
            "games": r["wins"] + r["losses"],
            "wins": r["wins"],
            "losses": r["losses"],
            "pct": round(win_pct(r), 3),
            "games_behind": gb,
            "streak": streak(r["results"]),
            "last10": last_ten(r["results"]),
            "trend": r["results"][-15:],  # 최근 15경기 승패 (트렌드 그래프용)
            "avg": batting_avg(team_stats.get(r["team_id"])),
            "era": team_era(team_stats.get(r["team_id"])),
            "playoff": playoff  # 플레이오프 진출권 (왼쪽 파란 선)
        }

    def sort_key(r):
        return (-win_pct(r), -r["wins"], r["team_name"])

    # 4. 리그·지구별로 묶어 순위 계산 (지구 1위 = 플레이오프 진출)
    divisions = []
    wildcards = []

    for league in ["AL", "NL"]:
        leader_ids = set()

        for division in DIVISION_ORDER:
            group = [
                r for r in records.values()
                if r["league"] == league
                and r["division"] == division
            ]
            group.sort(key=sort_key)

            leader = group[0] if group else None

            if leader:
                leader_ids.add(leader["team_id"])

            rows = [
                make_row(
                    rank,
                    r,
                    games_behind(leader, r),
                    rank == 1
                )
                for rank, r in enumerate(group, start=1)
            ]

            divisions.append({
                "league": league,
                "division": division,
                "teams": rows
            })

        # 5. 와일드카드: 지구 1위를 뺀 팀 중 승률 상위 3팀이 진출
        # 게임차는 마지막 진출 자리(3위) 기준
        # 앞서면 "+4", 3위는 "-", 뒤지면 "2.5"
        others = sorted(
            (
                r for r in records.values()
                if r["league"] == league
                and r["team_id"] not in leader_ids
            ),
            key=sort_key
        )

        cutoff = (
            others[WILDCARD_SPOTS - 1]
            if len(others) >= WILDCARD_SPOTS
            else None
        )

        rows = [
            make_row(
                rank,
                r,
                wildcard_games_behind(cutoff, r),
                rank <= WILDCARD_SPOTS
            )
            for rank, r in enumerate(others, start=1)
        ]

        wildcards.append({
            "league": league,
            "teams": rows
        })

    return {
        "season": season,
        "seasons": seasons,
        "divisions": divisions,
        "wildcards": wildcards
    }


def win_pct(r):
    played = r["wins"] + r["losses"]
    return r["wins"] / played if played else 0


def games_behind(leader, r):
    # 게임차 = ((1위 승 - 내 승) + (내 패 - 1위 패)) / 2
    # 1위는 "-"
    if leader is None or leader["team_id"] == r["team_id"]:
        return "-"

    gb = (
        (leader["wins"] - r["wins"])
        + (r["losses"] - leader["losses"])
    ) / 2

    if gb == 0:
        return "-"

    return f"{gb:g}"  # 3.0 → "3", 2.5 → "2.5"


def wildcard_games_behind(cutoff, r):
    # 마지막 진출 팀(cutoff)과의 게임차
    # 앞서면 "+4", 같으면 "-", 뒤지면 "2.5"
    if cutoff is None:
        return "-"

    gb = (
        (cutoff["wins"] - r["wins"])
        + (r["losses"] - cutoff["losses"])
    ) / 2

    if gb == 0:
        return "-"

    return f"+{-gb:g}" if gb < 0 else f"{gb:g}"


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


def batting_avg(stats):
    # 타율 = 안타 ÷ 타수 → ".254" (기록 없으면 "-")
    if not stats or not stats["at_bats"]:
        return "-"

    return f"{stats['hits'] / stats['at_bats']:.3f}".lstrip("0")


def team_era(stats):
    # 평균자책 = 자책점 × 9 ÷ 이닝 = 자책점 × 27 ÷ 아웃카운트 → "3.85"
    if not stats or not stats["outs"]:
        return "-"

    return f"{stats['earned_runs'] * 27 / stats['outs']:.2f}"


def last_ten(results):
    recent = results[-10:]

    if not recent:
        return "-"

    wins = recent.count("W")
    return f"{wins}승 {len(recent) - wins}패"
