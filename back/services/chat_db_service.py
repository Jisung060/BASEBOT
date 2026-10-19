"""
BASEBOT AI 챗봇의 MySQL 조회 전용 서비스.

파일 위치:
    back/services/chat_db_service.py

주의:
- users 테이블은 조회하지 않습니다.
- 사용자 질문을 SQL 문자열로 직접 실행하지 않습니다.
- 실제 basebot_db 스키마에 존재하는 테이블과 컬럼만 사용합니다.
- 기존 RAG / Gemini / ML 예측 기능과 독립적으로 동작합니다.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session


MAX_ROWS = 10
DEFAULT_RECENT_GAMES = 50
MAX_RECENT_GAMES = 162


# =========================================================
# 공통 유틸리티
# =========================================================

def _clean(value: Any) -> str:
    if value is None:
        return "-"
    return str(value)


def _format_rows(
    title: str,
    rows: list[dict[str, Any]],
) -> str:
    if not rows:
        return f"[{title}]\nDB 조회 결과가 없습니다."

    lines = [
        f"[{title}]",
        f"조회 건수: {len(rows)}",
    ]

    for index, row in enumerate(rows, start=1):
        fields = [
            f"{key}: {_clean(value)}"
            for key, value in row.items()
        ]
        lines.append(f"{index}. " + " / ".join(fields))

    return "\n".join(lines)


def _parse_recent_game_limit(question: str) -> int:
    q = question.strip().casefold()

    korean_numbers = {
        "한": 1,
        "두": 2,
        "세": 3,
        "네": 4,
        "다섯": 5,
        "여섯": 6,
        "일곱": 7,
        "여덟": 8,
        "아홉": 9,
        "열": 10,
        "스무": 20,
        "서른": 30,
        "마흔": 40,
        "쉰": 50,
        "예순": 60,
        "일흔": 70,
        "여든": 80,
        "아흔": 90,
        "백": 100,
    }

    match = re.search(r"최근\s*(\d+)\s*경기", q)

    if match:
        return max(1, min(int(match.group(1)), MAX_RECENT_GAMES))

    for korean, number in sorted(
        korean_numbers.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    ):
        if re.search(rf"최근\s*{korean}\s*경기", q):
            return min(number, MAX_RECENT_GAMES)

    return DEFAULT_RECENT_GAMES


def _date_filter(
    question: str,
    column: str,
    params: dict[str, Any],
    where: list[str],
) -> str | None:
    """
    질문에 포함된 날짜 표현을 SQL 조건으로 변환합니다.

    반환값:
        today / tomorrow / day_after_tomorrow / yesterday / None
    """
    q = question.strip().casefold()

    date_conditions = (
        (("오늘", "금일"), "today", f"{column} = CURDATE()"),
        (
            ("내일",),
            "tomorrow",
            f"{column} = DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
        ),
        (
            ("모레",),
            "day_after_tomorrow",
            f"{column} = DATE_ADD(CURDATE(), INTERVAL 2 DAY)",
        ),
        (
            ("어제",),
            "yesterday",
            f"{column} = DATE_SUB(CURDATE(), INTERVAL 1 DAY)",
        ),
    )

    for words, date_label, condition in date_conditions:
        if any(word in q for word in words):
            where.append(condition)
            return date_label

    return None


# =========================================================
# 구단 / 선수 식별
# =========================================================

TEAM_ALIASES = {
    "다저스": [
        "다저스",
        "la 다저스",
        "엘에이 다저스",
        "los angeles dodgers",
        "dodgers",
        "lad",
    ],
    "양키스": [
        "양키스",
        "뉴욕 양키스",
        "new york yankees",
        "yankees",
        "nyy",
    ],
    "레드삭스": [
        "레드삭스",
        "보스턴 레드삭스",
        "boston red sox",
        "red sox",
        "redsox",
        "bos",
    ],
    "애스트로스": [
        "애스트로스",
        "휴스턴 애스트로스",
        "houston astros",
        "astros",
        "hou",
    ],
}

TEAM_DB_MARKERS = {
    "다저스": ("dodger", "다저스", "lad"),
    "양키스": ("yankee", "양키스", "nyy"),
    "레드삭스": ("red sox", "redsox", "레드삭스", "bos"),
    "애스트로스": ("astro", "애스트로스", "hou"),
}


def _find_team_names(
    db: Session,
    question: str,
) -> list[dict[str, Any]]:
    rows = db.execute(
        text("""
            SELECT
                team_id,
                team_name,
                team_code
            FROM teams
            ORDER BY CHAR_LENGTH(team_name) DESC
        """)
    ).mappings().all()

    q = question.casefold()
    found: dict[Any, dict[str, Any]] = {}

    for row in rows:
        team = dict(row)

        name = str(team["team_name"] or "").casefold()
        code = str(team["team_code"] or "").casefold()

        matched = (
            bool(name and name in q)
            or bool(code and code in q)
        )

        if not matched:
            for alias_key, aliases in TEAM_ALIASES.items():
                markers = TEAM_DB_MARKERS[alias_key]

                belongs_to_group = any(
                    marker in name or marker in code
                    for marker in markers
                )

                if not belongs_to_group:
                    continue

                if any(alias.casefold() in q for alias in aliases):
                    matched = True
                    break

        if matched:
            found[team["team_id"]] = team

    return list(found.values())


def _find_player(
    db: Session,
    question: str,
) -> dict[str, Any] | None:
    rows = db.execute(
        text("""
            SELECT
                player_id,
                player_name,
                team_id
            FROM players
            ORDER BY CHAR_LENGTH(player_name) DESC
        """)
    ).mappings().all()

    q = question.casefold()

    for row in rows:
        player_name = str(row["player_name"] or "").casefold()

        if player_name and player_name in q:
            return dict(row)

    return None


# =========================================================
# 구단 정보
# =========================================================

def _team_context(
    db: Session,
    question: str,
) -> str:
    matched = _find_team_names(db, question)

    if matched:
        ids = [row["team_id"] for row in matched]

        stmt = text("""
            SELECT
                team_id,
                team_name,
                team_code,
                league,
                division,
                city,
                stadium
            FROM teams
            WHERE team_id IN :team_ids
            ORDER BY team_name
        """).bindparams(
            bindparam("team_ids", expanding=True)
        )

        rows = db.execute(
            stmt,
            {"team_ids": ids},
        ).mappings().all()

        return _format_rows("구단 정보", [dict(row) for row in rows])

    rows = db.execute(
        text("""
            SELECT
                team_id,
                team_name,
                team_code,
                league,
                division,
                city,
                stadium
            FROM teams
            ORDER BY league, division, team_name
            LIMIT 30
        """)
    ).mappings().all()

    return _format_rows("구단 목록", [dict(row) for row in rows])


# =========================================================
# 선수 정보 / 선수 시즌 기록
# =========================================================

def _player_context(
    db: Session,
    question: str,
) -> str:
    player = _find_player(db, question)
    teams = _find_team_names(db, question)

    if player:
        rows = db.execute(
            text("""
                SELECT
                    p.player_id,
                    p.player_name,
                    p.jersey_number,
                    p.position,
                    p.birth_date,
                    p.bats,
                    p.throws,
                    t.team_name
                FROM players p
                LEFT JOIN teams t
                    ON p.team_id = t.team_id
                WHERE p.player_id = :player_id
            """),
            {"player_id": player["player_id"]},
        ).mappings().all()

    elif teams:
        rows = db.execute(
            text("""
                SELECT
                    p.player_id,
                    p.player_name,
                    p.jersey_number,
                    p.position,
                    p.birth_date,
                    p.bats,
                    p.throws,
                    t.team_name
                FROM players p
                LEFT JOIN teams t
                    ON p.team_id = t.team_id
                WHERE p.team_id = :team_id
                ORDER BY p.player_name
                LIMIT :limit
            """),
            {
                "team_id": teams[0]["team_id"],
                "limit": 30,
            },
        ).mappings().all()

    else:
        rows = db.execute(
            text("""
                SELECT
                    p.player_id,
                    p.player_name,
                    p.jersey_number,
                    p.position,
                    p.birth_date,
                    p.bats,
                    p.throws,
                    t.team_name
                FROM players p
                LEFT JOIN teams t
                    ON t.team_id = p.team_id
                ORDER BY p.player_name
                LIMIT 30
            """)
        ).mappings().all()

    return _format_rows("선수 정보", [dict(row) for row in rows])


def _stats_context(
    db: Session,
    question: str,
) -> str:
    """선수 또는 구단의 선수 시즌 기록을 조회합니다."""
    player = _find_player(db, question)
    teams = _find_team_names(db, question)

    q = question.casefold()

    is_pitcher = any(
        word in q
        for word in (
            "투수",
            "방어율",
            "자책점",
            "whip",
            "삼진",
            "탈삼진",
            "피칭",
            "투구",
        )
    )

    where = []
    params: dict[str, Any] = {"limit": MAX_ROWS}

    if player:
        where.append("p.player_id = :player_id")
        params["player_id"] = player["player_id"]

    if teams:
        where.append("s.team_id = :team_id")
        params["team_id"] = teams[0]["team_id"]

    if is_pitcher:
        where.append("s.is_pitcher = 1")
    elif any(
        word in q
        for word in (
            "타자",
            "타율",
            "홈런",
            "타점",
            "장타",
            "출루",
            "안타",
            "도루",
        )
    ):
        where.append("s.is_pitcher = 0")

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    rows = db.execute(
        text(f"""
            SELECT
                p.player_name,
                t.team_name,
                s.season,
                CASE
                    WHEN s.is_pitcher = 1 THEN '투수'
                    ELSE '타자'
                END AS player_type,
                s.games,
                s.batting_avg,
                s.hits,
                s.home_runs,
                s.rbi,
                s.stolen_bases,
                s.wins,
                s.losses,
                s.era,
                s.innings_pitched,
                s.strikeouts,
                s.walks,
                s.whip,
                s.bwar,
                s.fwar,
                s.wrc_plus,
                s.fip,
                s.xera,
                s.avg_exit_velocity,
                s.barrel_percentage,
                s.hard_hit_percentage,
                s.xba,
                s.xslg,
                s.xwoba
            FROM player_season_stats s
            JOIN players p
                ON p.player_id = s.player_id
            LEFT JOIN teams t
                ON t.team_id = s.team_id
            {where_sql}
            ORDER BY
                s.season DESC,
                s.games DESC,
                p.player_name
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    return _format_rows("선수 시즌 기록", [dict(row) for row in rows])


def _team_stats_context(
    db: Session,
    question: str,
) -> str:
    """
    구단별 선수 시즌 기록을 요약합니다.

    타자와 투수 집계를 분리해 서로 다른 기록이
    JOIN 과정에서 중복 집계되지 않도록 합니다.
    """
    teams = _find_team_names(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}

    if teams:
        return _stats_context(db, question)

    rows = db.execute(
        text("""
            SELECT
                t.team_name,
                s.season,
                COUNT(DISTINCT s.player_id) AS player_count,
                ROUND(AVG(s.batting_avg), 3) AS avg_batting_avg,
                SUM(s.hits) AS total_hits,
                SUM(s.home_runs) AS total_home_runs,
                SUM(s.rbi) AS total_rbi
            FROM player_season_stats s
            JOIN teams t
                ON t.team_id = s.team_id
            WHERE s.is_pitcher = 0
            GROUP BY
                t.team_id,
                t.team_name,
                s.season
            ORDER BY
                s.season DESC,
                total_home_runs DESC,
                t.team_name
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    hitter_context = _format_rows(
        "구단별 타자 시즌 기록",
        [dict(row) for row in rows],
    )

    pitcher_rows = db.execute(
        text("""
            SELECT
                t.team_name,
                s.season,
                COUNT(DISTINCT s.player_id) AS pitcher_count,
                ROUND(AVG(s.era), 3) AS avg_era,
                ROUND(AVG(s.whip), 3) AS avg_whip,
                SUM(s.strikeouts) AS total_strikeouts,
                SUM(s.wins) AS total_wins
            FROM player_season_stats s
            JOIN teams t
                ON t.team_id = s.team_id
            WHERE s.is_pitcher = 1
            GROUP BY
                t.team_id,
                t.team_name,
                s.season
            ORDER BY
                s.season DESC,
                avg_era ASC,
                t.team_name
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    pitcher_context = _format_rows(
        "구단별 투수 시즌 기록",
        [dict(row) for row in pitcher_rows],
    )

    return hitter_context + "\n\n" + pitcher_context


# =========================================================
# 개인 기록 순위
# =========================================================

def _leader_context(
    db: Session,
    question: str,
) -> str:
    q = question.casefold()

    if any(
        word in q
        for word in (
            "탈삼진",
            "삼진 1위",
            "삼진 순위",
            "삼진이 가장",
        )
    ):
        title = "탈삼진 순위"
        stat_column = "s.strikeouts"
        pitcher_filter = "AND s.is_pitcher = 1"

    elif "타율" in q:
        title = "타율 순위"
        stat_column = "s.batting_avg"
        pitcher_filter = "AND s.is_pitcher = 0"

    else:
        title = "홈런 순위"
        stat_column = "s.home_runs"
        pitcher_filter = "AND s.is_pitcher = 0"

    rows = db.execute(
        text(f"""
            SELECT
                p.player_name,
                t.team_name,
                s.season,
                s.games,
                s.batting_avg,
                s.home_runs,
                s.strikeouts,
                s.innings_pitched,
                s.era
            FROM player_season_stats s
            JOIN players p
                ON p.player_id = s.player_id
            LEFT JOIN teams t
                ON t.team_id = s.team_id
            WHERE s.season = (
                SELECT MAX(season)
                FROM player_season_stats
            )
            {pitcher_filter}
            AND {stat_column} IS NOT NULL
            ORDER BY
                {stat_column} DESC,
                s.games DESC,
                p.player_name ASC
            LIMIT :limit
        """),
        {"limit": MAX_ROWS},
    ).mappings().all()

    return _format_rows(title, [dict(row) for row in rows])


# =========================================================
# 현재 최장 연승
# =========================================================

def _winning_streak_context(db: Session) -> str:
    games = db.execute(
        text("""
            SELECT
                game_id,
                game_date,
                game_time,
                home_team_id,
                away_team_id,
                winning_team_id
            FROM games
            WHERE status = 'FINAL'
              AND winning_team_id IS NOT NULL
            ORDER BY
                game_date DESC,
                game_time DESC,
                game_id DESC
        """)
    ).mappings().all()

    team_rows = db.execute(
        text("SELECT team_id, team_name FROM teams")
    ).mappings().all()

    team_names = {
        row["team_id"]: row["team_name"]
        for row in team_rows
    }

    streaks: dict[Any, int] = {}
    stopped: set[Any] = set()

    for game in games:
        home_id = game["home_team_id"]
        away_id = game["away_team_id"]
        winner_id = game["winning_team_id"]

        for team_id in (home_id, away_id):
            if team_id in stopped:
                continue

            if winner_id == team_id:
                streaks[team_id] = streaks.get(team_id, 0) + 1
            else:
                stopped.add(team_id)

    if not streaks:
        return (
            "[현재 최장 연승]\n"
            "연승을 계산할 수 있는 종료 경기 데이터가 없습니다."
        )

    max_streak = max(streaks.values())

    leaders = [
        {
            "team_name": team_names.get(team_id, str(team_id)),
            "current_winning_streak": streak,
        }
        for team_id, streak in streaks.items()
        if streak == max_streak
    ]

    leaders.sort(key=lambda row: row["team_name"])

    return _format_rows("현재 최장 연승", leaders)


# =========================================================
# 경기 일정 및 결과
# =========================================================

def _game_context(
    db: Session,
    question: str,
) -> str:
    q = question.strip().casefold()
    teams = _find_team_names(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}
    where: list[str] = []

    is_recent = any(
        word in q
        for word in (
            "최근",
            "지난 경기",
            "완료된 경기",
            "종료된 경기",
        )
    )

    is_result_question = any(
        word in q
        for word in (
            "경기 결과",
            "경기 스코어",
            "결과 알려",
            "결과 보여",
            "점수 알려",
            "스코어 알려",
            "몇 대 몇",
            "몇대몇",
            "승리 팀",
            "이긴 팀",
            "종료된",
            "완료된",
        )
    )

    is_cancelled_question = "취소" in q

    has_schedule_keyword = any(
        word in q
        for word in (
            "일정",
            "예정",
            "스케줄",
            "경기 언제",
            "언제 경기",
        )
    )

    has_date_keyword = any(
        word in q
        for word in ("오늘", "금일", "내일", "모레", "어제")
    )

    is_schedule_question = (
        not is_result_question
        and not is_cancelled_question
        and (has_schedule_keyword or has_date_keyword)
    )

    _date_filter(question, "g.game_date", params, where)

    if not any(
        token in q for token in ("오늘", "금일", "내일", "모레", "어제")
    ):
        if is_recent:
            where.append("g.status = 'FINAL'")
        elif is_schedule_question:
            where.append("g.game_date >= CURDATE()")

    if teams:
        where.append(
            "(g.home_team_id = :team_id "
            "OR g.away_team_id = :team_id)"
        )
        params["team_id"] = teams[0]["team_id"]

    if is_cancelled_question:
        where.append("g.status = 'CANCELLED'")
    elif is_result_question or is_recent:
        where.append("g.status = 'FINAL'")
    elif is_schedule_question:
        where.append("g.status IN ('SCHEDULED', 'IN_PROGRESS')")

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    if is_recent:
        order_sql = "g.game_date DESC, g.game_time DESC, g.game_id DESC"
        params["limit"] = _parse_recent_game_limit(question)
    else:
        order_sql = "g.game_date ASC, g.game_time ASC, g.game_id ASC"

    rows = db.execute(
        text(f"""
            SELECT
                g.game_id,
                g.game_date,
                g.game_time,
                home.team_name AS home_team,
                away.team_name AS away_team,
                g.home_score,
                g.away_score,
                winner.team_name AS winning_team,
                g.stadium,
                g.status
            FROM games g
            JOIN teams home
                ON home.team_id = g.home_team_id
            JOIN teams away
                ON away.team_id = g.away_team_id
            LEFT JOIN teams winner
                ON winner.team_id = g.winning_team_id
            {where_sql}
            ORDER BY {order_sql}
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    result = _format_rows("경기 일정 및 결과", [dict(row) for row in rows])

    print(f"[챗봇 경기 조회] 질문: {question}")
    print(f"[챗봇 경기 조회] 일정 질문: {is_schedule_question}")
    print(f"[챗봇 경기 조회] 결과 질문: {is_result_question}")
    print(f"[챗봇 경기 조회] 취소 질문: {is_cancelled_question}")
    print(f"[챗봇 경기 조회] 조회 건수: {len(rows)}")
    print(f"[챗봇 경기 조회] 컨텍스트:\n{result}")

    return result


# =========================================================
# 경기별 선수 기록
# =========================================================

def _boxscore_context(
    db: Session,
    question: str,
) -> str:
    player = _find_player(db, question)
    teams = _find_team_names(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}
    where = []

    if player:
        where.append("b.player_id = :player_id")
        params["player_id"] = player["player_id"]

    if teams:
        where.append("b.team_id = :team_id")
        params["team_id"] = teams[0]["team_id"]

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    rows = db.execute(
        text(f"""
            SELECT
                g.game_date,
                g.game_id,
                t.team_name,
                p.player_name,
                b.position,
                b.batting_order,
                b.at_bats,
                b.hits,
                b.home_runs,
                b.rbi,
                b.walks,
                b.strikeouts,
                b.innings_pitched,
                b.earned_runs,
                b.runs_allowed,
                b.hits_allowed,
                b.strikeouts_pitched,
                b.pitch_count
            FROM game_boxscores b
            JOIN games g
                ON g.game_id = b.game_id
            JOIN teams t
                ON t.team_id = b.team_id
            JOIN players p
                ON p.player_id = b.player_id
            {where_sql}
            ORDER BY g.game_date DESC, g.game_id DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    return _format_rows("경기별 선수 기록", [dict(row) for row in rows])


# =========================================================
# 뉴스
# =========================================================

def _news_context(
    db: Session,
    question: str,
) -> str:
    teams = _find_team_names(db, question)
    player = _find_player(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}
    where = ["n.status = 'ACTIVE'"]

    if teams:
        where.append("n.related_team_id = :team_id")
        params["team_id"] = teams[0]["team_id"]

    if player:
        where.append("n.related_player_id = :player_id")
        params["player_id"] = player["player_id"]

    rows = db.execute(
        text(f"""
            SELECT
                n.title,
                n.source_name,
                n.author,
                n.published_at,
                n.summary,
                n.category,
                n.keywords,
                n.source_url,
                t.team_name AS related_team,
                p.player_name AS related_player
            FROM mlb_news n
            LEFT JOIN teams t
                ON t.team_id = n.related_team_id
            LEFT JOIN players p
                ON p.player_id = n.related_player_id
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(n.published_at, n.crawled_at) DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    return _format_rows("MLB 뉴스", [dict(row) for row in rows])


# =========================================================
# 공지사항
# =========================================================

def _notice_context(db: Session) -> str:
    rows = db.execute(
        text("""
            SELECT
                notice_id,
                category,
                title,
                content,
                is_pinned,
                created_at
            FROM notice
            ORDER BY is_pinned DESC, created_at DESC
            LIMIT 10
        """)
    ).mappings().all()

    return _format_rows("공지사항", [dict(row) for row in rows])


# =========================================================
# 커뮤니티
# =========================================================

def _community_context(
    db: Session,
    question: str,
) -> str:
    teams = _find_team_names(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}
    where = ["p.status = 'ACTIVE'"]

    if teams:
        where.append("p.related_team_id = :team_id")
        params["team_id"] = teams[0]["team_id"]

    rows = db.execute(
        text(f"""
            SELECT
                p.post_id,
                p.category,
                p.title,
                p.content,
                p.view_count,
                p.like_count,
                p.comment_count,
                p.created_at,
                t.team_name AS related_team
            FROM community_posts p
            LEFT JOIN teams t
                ON t.team_id = p.related_team_id
            WHERE {' AND '.join(where)}
            ORDER BY p.created_at DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    return _format_rows("커뮤니티 게시글", [dict(row) for row in rows])


# =========================================================
# 예측 참여 현황
# =========================================================

def _prediction_vote_context(
    db: Session,
    question: str,
) -> str:
    """
    날짜별 경기 투표 현황을 조회합니다.

    날짜를 지정하면 해당 날짜의 경기만 조회합니다.
    날짜를 지정하지 않으면 전체 경기의 투표 현황을 조회합니다.
    투표가 없는 경기 역시 결과에 포함합니다.
    """
    teams = _find_team_names(db, question)

    params: dict[str, Any] = {"limit": MAX_ROWS}
    where: list[str] = []

    _date_filter(question, "g.game_date", params, where)

    if teams:
        where.append(
            "(g.home_team_id = :team_id "
            "OR g.away_team_id = :team_id)"
        )
        params["team_id"] = teams[0]["team_id"]

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    rows = db.execute(
        text(f"""
            SELECT
                g.game_id,
                g.game_date,
                g.status,
                home.team_name AS home_team,
                away.team_name AS away_team,
                selected.team_name AS selected_team,
                COUNT(v.vote_id) AS vote_count,
                COALESCE(SUM(v.bet_point), 0) AS total_bet_points,
                COALESCE(SUM(
                    CASE
                        WHEN v.is_correct = 1 THEN 1
                        ELSE 0
                    END
                ), 0) AS correct_votes
            FROM games g
            JOIN teams home
                ON home.team_id = g.home_team_id
            JOIN teams away
                ON away.team_id = g.away_team_id
            LEFT JOIN prediction_votes v
                ON v.game_id = g.game_id
            LEFT JOIN teams selected
                ON selected.team_id = v.selected_team_id
            {where_sql}
            GROUP BY
                g.game_id,
                g.game_date,
                g.status,
                home.team_name,
                away.team_name,
                selected.team_name
            ORDER BY
                g.game_date DESC,
                vote_count DESC,
                g.game_id DESC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    date_label = _get_question_date_label(question)

    if date_label:
        title = f"{date_label} 승부예측 투표 현황"
    else:
        title = "전체 경기별 승부예측 투표 현황"

    result = _format_rows(title, [dict(row) for row in rows])

    print(f"[챗봇 예측 투표 조회] 질문: {question}")
    print(f"[챗봇 예측 투표 조회] 날짜: {date_label or '전체'}")
    print(f"[챗봇 예측 투표 조회] 조회 건수: {len(rows)}")

    return result


def _get_question_date_label(question: str) -> str | None:
    q = question.casefold()

    if "오늘" in q or "금일" in q:
        return "오늘"
    if "내일" in q:
        return "내일"
    if "모레" in q:
        return "모레"
    if "어제" in q:
        return "어제"

    return None


def _prediction_team_ranking_context(
    db: Session,
    question: str = "",
) -> str:
    """날짜별 또는 전체 팀별 예측 투표 순위를 조회합니다."""
    params: dict[str, Any] = {"limit": MAX_ROWS}
    where: list[str] = []

    _date_filter(question, "g.game_date", params, where)

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    rows = db.execute(
        text(f"""
            SELECT
                t.team_name AS selected_team,
                COUNT(v.vote_id) AS vote_count,
                COALESCE(SUM(v.bet_point), 0) AS total_bet_points,
                COUNT(DISTINCT v.game_id) AS game_count
            FROM prediction_votes v
            JOIN games g
                ON g.game_id = v.game_id
            JOIN teams t
                ON t.team_id = v.selected_team_id
            {where_sql}
            GROUP BY
                t.team_id,
                t.team_name
            ORDER BY
                vote_count DESC,
                total_bet_points DESC,
                t.team_name ASC
            LIMIT :limit
        """),
        params,
    ).mappings().all()

    date_label = _get_question_date_label(question)
    title = (
        f"{date_label} 팀별 예측 투표 순위"
        if date_label
        else "전체 팀별 예측 투표 순위"
    )

    return _format_rows(title, [dict(row) for row in rows])


# =========================================================
# 최근 팀 성적
# =========================================================

def _recent_form_context(
    db: Session,
    question: str,
) -> str:
    teams = _find_team_names(db, question)

    if not teams:
        return _game_context(db, question)

    team = teams[0]
    game_limit = _parse_recent_game_limit(question)

    rows = db.execute(
        text("""
            SELECT
                g.game_id,
                g.game_date,
                g.game_time,
                g.home_team_id,
                g.away_team_id,
                g.home_score,
                g.away_score,
                g.winning_team_id,
                CASE
                    WHEN g.home_team_id = :team_id
                    THEN home.team_name
                    ELSE away.team_name
                END AS team_name,
                CASE
                    WHEN g.home_team_id = :team_id
                    THEN away.team_name
                    ELSE home.team_name
                END AS opponent,
                CASE
                    WHEN g.winning_team_id = :team_id
                    THEN '승'
                    WHEN g.winning_team_id IS NULL
                    THEN '미정'
                    ELSE '패'
                END AS result
            FROM games g
            JOIN teams home
                ON home.team_id = g.home_team_id
            JOIN teams away
                ON away.team_id = g.away_team_id
            WHERE (
                g.home_team_id = :team_id
                OR g.away_team_id = :team_id
            )
              AND g.status = 'FINAL'
            ORDER BY
                g.game_date DESC,
                g.game_time DESC,
                g.game_id DESC
            LIMIT :game_limit
        """),
        {
            "team_id": team["team_id"],
            "game_limit": game_limit,
        },
    ).mappings().all()

    results = [dict(row) for row in rows]

    wins = sum(row["result"] == "승" for row in results)
    losses = sum(row["result"] == "패" for row in results)
    total = wins + losses
    win_rate = wins / total if total else 0

    summary = (
        f"[{team['team_name']} 최근 경기 성적]\n"
        f"조회 경기 수: {len(results)}\n"
        f"승리: {wins}경기\n"
        f"패배: {losses}경기\n"
        f"승률: {win_rate:.3f}\n"
    )

    if not results:
        return summary + "조회 가능한 종료 경기 데이터가 없습니다."

    return summary + "\n" + _format_rows("최근 경기 상세", results)


# =========================================================
# DB 질문 라우터
# =========================================================

def get_database_context(
    db: Session,
    question: str,
) -> str | None:
    """
    질문에 맞는 DB 조회 컨텍스트를 반환합니다.

    관련 DB 질문이 아니면 None을 반환하여
    기존 RAG / ML 예측 / 일반 답변 흐름을 유지합니다.

    users 테이블 및 개인 식별 정보는 조회하지 않습니다.
    """
    q = question.strip().casefold()

    if not q:
        return None

    # -----------------------------------------------------
    # 개인 정보 질문은 이 모듈에서 처리하지 않습니다.
    # -----------------------------------------------------
    if any(
        word in q
        for word in (
            "내 포인트",
            "내 등급",
            "내 정보",
            "내 관심팀",
            "내 연승",
        )
    ):
        return None

    # -----------------------------------------------------
    # 예측 참여 현황 질문 구분
    # -----------------------------------------------------

    # 오늘/금일 + 예측/승부/투표/참여 표현이 함께 있으면
    # 오늘의 경기별 예측 투표 현황 질문으로 처리합니다.
    is_today_vote_question = (
        any(word in q for word in ("오늘", "금일"))
        and any(
            word in q
            for word in (
                "예측",
                "승부",
                "투표",
                "참여",
            )
        )
    )

    # 기존 투표 현황 질문 표현은 그대로 지원합니다.
    is_vote_question = is_today_vote_question or any(
        word in q
        for word in (
            "경기 예측",
            "승부 예측",
            "예측 참여",
            "투표 현황",
            "예측 투표",
            "투표 비율",
            "투표가 많이",
            "투표가 몰린",
            "투표 순위",
            "투표 수",
            "투표수",
            "예측 현황",
            "참여 현황",
            "예측 참여 현황",
            "투표가 많이 몰렸",
            "표를 많이 받은",
            "많은 표",
        )
    )

    # 실제 승부예측 요청은 기존 ML predictor에서 처리합니다.
    # 단, 위에서 판별한 투표 현황 질문은 DB 조회를 우선합니다.
    if (
        not is_vote_question
        and any(
            word in q
            for word in (
                "누가 이길",
                "누가 이겨",
                "승리 가능성",
                "이길 가능성",
                "예측해",
            )
        )
    ):
        return None

    try:
        # -------------------------------------------------
        # 1. 팀별 예측 투표 순위
        # -------------------------------------------------
        is_team_vote_ranking_question = any(
            word in q
            for word in (
                "투표가 많이",
                "투표가 몰린",
                "어떤 팀에",
                "투표 순위",
                "가장 많이 투표",
                "팀별 투표",
                "많이 몰렸",
                "많이 참여",
                "표를 많이 받은",
                "많은 표",
            )
        )

        if is_vote_question and is_team_vote_ranking_question:
            return _prediction_team_ranking_context(db, question)

        # -------------------------------------------------
        # 2. 경기별 예측 투표 현황
        # -------------------------------------------------
        if is_vote_question:
            return _prediction_vote_context(db, question)

        # -------------------------------------------------
        # 3. 현재 최장 연승
        # -------------------------------------------------
        if any(
            word in q
            for word in (
                "현재 가장 긴 연승",
                "최장 연승",
                "연승 중인 팀",
                "연승 기록 중",
                "가장 오래 연승",
                "가장 긴 연승",
            )
        ):
            return _winning_streak_context(db)

        # -------------------------------------------------
        # 4. 개인 기록 순위
        # -------------------------------------------------
        is_leader_question = any(
            word in q
            for word in (
                "1위",
                "1 위",
                "순위",
                "리더",
                "가장 많은",
                "가장 높은",
                "최고",
            )
        )

        if is_leader_question and any(
            word in q
            for word in (
                "홈런",
                "타율",
                "탈삼진",
                "삼진",
            )
        ):
            return _leader_context(db, question)

        # -------------------------------------------------
        # 5. 뉴스 / 공지 / 커뮤니티
        # -------------------------------------------------
        if any(word in q for word in ("뉴스", "기사", "소식")):
            return _news_context(db, question)

        if any(
            word in q
            for word in ("공지", "점검 공지", "공지사항")
        ):
            return _notice_context(db)

        if any(
            word in q
            for word in (
                "게시글",
                "커뮤니티",
                "분석 글",
                "게시판",
            )
        ):
            return _community_context(db, question)

        # -------------------------------------------------
        # 6. 경기별 기록 / 박스스코어
        # -------------------------------------------------
        if any(
            word in q
            for word in (
                "경기별 기록",
                "박스스코어",
                "경기 기록",
                "경기에서",
                "경기에서의",
            )
        ):
            return _boxscore_context(db, question)

        # -------------------------------------------------
        # 7. 특정 구단의 최근 경기 성적
        # -------------------------------------------------
        teams = _find_team_names(db, question)

        if (
            teams
            and any(
                word in q
                for word in (
                    "최근 경기",
                    "최근 전적",
                    "최근 성적",
                    "최근 결과",
                    "최근 몇 경기",
                )
            )
        ):
            return _recent_form_context(db, question)

        # -------------------------------------------------
        # 8. 경기 일정 / 결과
        # -------------------------------------------------
        is_game_question = any(
            word in q
            for word in (
                "경기",
                "게임",
                "매치",
                "일정",
                "스케줄",
                "스코어",
                "결과",
                "예정 경기",
                "취소 경기",
            )
        )

        has_date_keyword = any(
            word in q
            for word in (
                "오늘",
                "금일",
                "내일",
                "모레",
                "어제",
            )
        )

        has_game_intent = any(
            word in q
            for word in (
                "일정",
                "스케줄",
                "경기 결과",
                "경기 스코어",
                "최근 경기",
                "경기 현황",
                "경기 목록",
                "예정 경기",
                "취소 경기",
            )
        )

        if is_game_question and (
            has_date_keyword or has_game_intent
        ):
            return _game_context(db, question)

        # -------------------------------------------------
        # 9. 선수 정보 / 구단별 선수 명단
        # -------------------------------------------------
        if any(
            word in q
            for word in (
                "선수 명단",
                "선수 정보",
                "선수 목록",
                "선수 소개",
                "선수 누구",
                "소속 선수",
                "등번호",
                "포지션",
            )
        ):
            return _player_context(db, question)

        # -------------------------------------------------
        # 10. 구단별 선수 기록
        # 구단 기본정보보다 먼저 처리해야 합니다.
        # -------------------------------------------------
        is_team_player_stats_question = (
            any(word in q for word in ("구단별", "팀별"))
            and any(
                word in q
                for word in (
                    "선수 기록",
                    "선수 성적",
                    "선수 통계",
                    "기록",
                    "성적",
                    "통계",
                )
            )
        )

        if is_team_player_stats_question:
            return _team_stats_context(db, question)

        # -------------------------------------------------
        # 11. 구단 정보
        # -------------------------------------------------
        is_team_info_question = any(
            word in q
            for word in (
                "팀 정보",
                "팀 목록",
                "팀 소개",
                "구단 정보",
                "구단 목록",
                "구단 소개",
                "연고지",
                "구장",
                "아메리칸리그 팀",
                "내셔널리그 팀",
            )
        )

        is_player_data_question = any(
            word in q
            for word in (
                "선수 기록",
                "선수 성적",
                "선수 통계",
                "선수 명단",
                "선수 정보",
                "타율",
                "홈런",
                "타점",
                "안타",
                "도루",
                "방어율",
                "탈삼진",
                "whip",
                "era",
                "war",
                "성적",
            )
        )

        if is_team_info_question and not is_player_data_question:
            return _team_context(db, question)

        # -------------------------------------------------
        # 12. 선수 시즌 기록
        # -------------------------------------------------
        if any(
            word in q
            for word in (
                "타율",
                "홈런",
                "타점",
                "안타",
                "도루",
                "era",
                "whip",
                "war",
                "wrc+",
                "fip",
                "xera",
                "xba",
                "xslg",
                "xwoba",
                "타구속도",
                "배럴",
                "하드힛",
                "삼진",
                "탈삼진",
                "승수",
                "패수",
                "기록",
                "통계",
                "성적",
            )
        ):
            return _stats_context(db, question)

    except Exception as exc:
        print(
            f"[챗봇 DB 조회 오류] "
            f"{type(exc).__name__}: {exc}"
        )

        return (
            "[DB 조회 오류]\n"
            "데이터베이스 조회 중 오류가 발생했습니다. "
            "조회 결과가 없다는 뜻은 아니며, "
            "서버 로그에서 원인을 확인해야 합니다."
        )

    return None