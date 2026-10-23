import os
import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import requests
from sqlalchemy import text
from database.db_connection import engine

MLB_TEAMS_API_URL = "https://statsapi.mlb.com/api/v1/teams?sportId=1&hydrate=venue,league,division"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# 온라인 API 호출 실패 시 사용할 Fallback 데이터 (Athletics 등 현시점 기준 반영)
FALLBACK_TEAMS_DATA = [
    # AL East
    (110, 'Baltimore Orioles', 'BAL', 'AL', 'East', 'Baltimore', 'Oriole Park at Camden Yards', 'https://www.mlbstatic.com/team-logos/110.svg'),
    (111, 'Boston Red Sox', 'BOS', 'AL', 'East', 'Boston', 'Fenway Park', 'https://www.mlbstatic.com/team-logos/111.svg'),
    (147, 'New York Yankees', 'NYY', 'AL', 'East', 'New York', 'Yankee Stadium', 'https://www.mlbstatic.com/team-logos/147.svg'),
    (139, 'Tampa Bay Rays', 'TB', 'AL', 'East', 'St. Petersburg', 'Tropicana Field', 'https://www.mlbstatic.com/team-logos/139.svg'),
    (141, 'Toronto Blue Jays', 'TOR', 'AL', 'East', 'Toronto', 'Rogers Centre', 'https://www.mlbstatic.com/team-logos/141.svg'),

    # AL Central
    (145, 'Chicago White Sox', 'CWS', 'AL', 'Central', 'Chicago', 'Rate Field', 'https://www.mlbstatic.com/team-logos/145.svg'),
    (114, 'Cleveland Guardians', 'CLE', 'AL', 'Central', 'Cleveland', 'Progressive Field', 'https://www.mlbstatic.com/team-logos/114.svg'),
    (116, 'Detroit Tigers', 'DET', 'AL', 'Central', 'Detroit', 'Comerica Park', 'https://www.mlbstatic.com/team-logos/116.svg'),
    (118, 'Kansas City Royals', 'KC', 'AL', 'Central', 'Kansas City', 'Kauffman Stadium', 'https://www.mlbstatic.com/team-logos/118.svg'),
    (142, 'Minnesota Twins', 'MIN', 'AL', 'Central', 'Minneapolis', 'Target Field', 'https://www.mlbstatic.com/team-logos/142.svg'),

    # AL West
    (117, 'Houston Astros', 'HOU', 'AL', 'West', 'Houston', 'Daikin Park', 'https://www.mlbstatic.com/team-logos/117.svg'),
    (108, 'Los Angeles Angels', 'LAA', 'AL', 'West', 'Anaheim', 'Angel Stadium', 'https://www.mlbstatic.com/team-logos/108.svg'),
    (133, 'Athletics', 'ATH', 'AL', 'West', 'Sacramento', 'Sutter Health Park', 'https://www.mlbstatic.com/team-logos/133.svg'),
    (136, 'Seattle Mariners', 'SEA', 'AL', 'West', 'Seattle', 'T-Mobile Park', 'https://www.mlbstatic.com/team-logos/136.svg'),
    (140, 'Texas Rangers', 'TEX', 'AL', 'West', 'Arlington', 'Globe Life Field', 'https://www.mlbstatic.com/team-logos/140.svg'),

    # NL East
    (144, 'Atlanta Braves', 'ATL', 'NL', 'East', 'Atlanta', 'Truist Park', 'https://www.mlbstatic.com/team-logos/144.svg'),
    (146, 'Miami Marlins', 'MIA', 'NL', 'East', 'Miami', 'loanDepot park', 'https://www.mlbstatic.com/team-logos/146.svg'),
    (121, 'New York Mets', 'NYM', 'NL', 'East', 'New York', 'Citi Field', 'https://www.mlbstatic.com/team-logos/121.svg'),
    (143, 'Philadelphia Phillies', 'PHI', 'NL', 'East', 'Philadelphia', 'Citizens Bank Park', 'https://www.mlbstatic.com/team-logos/143.svg'),
    (120, 'Washington Nationals', 'WSH', 'NL', 'East', 'Washington', 'Nationals Park', 'https://www.mlbstatic.com/team-logos/120.svg'),

    # NL Central
    (112, 'Chicago Cubs', 'CHC', 'NL', 'Central', 'Chicago', 'Wrigley Field', 'https://www.mlbstatic.com/team-logos/112.svg'),
    (113, 'Cincinnati Reds', 'CIN', 'NL', 'Central', 'Cincinnati', 'Great American Ball Park', 'https://www.mlbstatic.com/team-logos/113.svg'),
    (158, 'Milwaukee Brewers', 'MIL', 'NL', 'Central', 'Milwaukee', 'American Family Field', 'https://www.mlbstatic.com/team-logos/158.svg'),
    (134, 'Pittsburgh Pirates', 'PIT', 'NL', 'Central', 'Pittsburgh', 'PNC Park', 'https://www.mlbstatic.com/team-logos/134.svg'),
    (138, 'St. Louis Cardinals', 'STL', 'NL', 'Central', 'St. Louis', 'Busch Stadium', 'https://www.mlbstatic.com/team-logos/138.svg'),

    # NL West
    (109, 'Arizona Diamondbacks', 'AZ', 'NL', 'West', 'Phoenix', 'Chase Field', 'https://www.mlbstatic.com/team-logos/109.svg'),
    (115, 'Colorado Rockies', 'COL', 'NL', 'West', 'Denver', 'Coors Field', 'https://www.mlbstatic.com/team-logos/115.svg'),
    (119, 'Los Angeles Dodgers', 'LAD', 'NL', 'West', 'Los Angeles', 'Dodger Stadium', 'https://www.mlbstatic.com/team-logos/119.svg'),
    (135, 'San Diego Padres', 'SD', 'NL', 'West', 'San Diego', 'Petco Park', 'https://www.mlbstatic.com/team-logos/135.svg'),
    (137, 'San Francisco Giants', 'SF', 'NL', 'West', 'San Francisco', 'Oracle Park', 'https://www.mlbstatic.com/team-logos/137.svg')
]
# ※ 참고: Colorado Rockies의 지구(Division)도 NL West로 정확히 보정되도록 아래 딕셔너리 변환 시 처리합니다.
FALLBACK_TEAMS_DATA = [
    (t[0], t[1], t[2], t[3], ('West' if t[0] == 115 else t[4]), t[5], t[6], t[7])
    for t in FALLBACK_TEAMS_DATA
]

# 하위 호환성을 위해 TEAMS_DATA 별칭 유지
TEAMS_DATA = FALLBACK_TEAMS_DATA


def _parse_league_abbr(league_obj: dict, default_val: str) -> str:
    abbr = str(league_obj.get("abbreviation") or "").strip().upper()
    if abbr in ("AL", "NL"):
        return abbr
    name = str(league_obj.get("name") or "").lower()
    if "american" in name:
        return "AL"
    if "national" in name:
        return "NL"
    return default_val


def _parse_division_short(div_obj: dict, default_val: str) -> str:
    name = str(div_obj.get("nameShort") or div_obj.get("name") or "").lower()
    if "east" in name:
        return "East"
    if "central" in name:
        return "Central"
    if "west" in name:
        return "West"
    return default_val


def fetch_teams_with_fallback() -> list[dict]:
    """
    1순위: MLB 공식 Stats API에서 실시간 구단명·연고지·홈구장·약어 조회
    2순위(Fallback): 네트워크 오류 또는 누락 시 FALLBACK_TEAMS_DATA 사용
    """
    fallback_map = {
        t[0]: {
            "team_id": t[0],
            "team_name": t[1],
            "team_code": t[2],
            "league": t[3],
            "division": t[4],
            "city": t[5],
            "stadium": t[6],
            "logo_url": t[7],
        }
        for t in FALLBACK_TEAMS_DATA
    }

    try:
        resp = requests.get(MLB_TEAMS_API_URL, headers=HEADERS, timeout=12)
        resp.raise_for_status()
        api_teams = resp.json().get("teams") or []

        if not api_teams:
            raise ValueError("MLB API 응답에 teams 배열이 비어 있습니다.")

        merged_map = dict(fallback_map)
        online_updated = 0

        for item in api_teams:
            if not item.get("active", True):
                continue
            tid = item.get("id")
            if tid not in merged_map:
                continue

            fb = merged_map[tid]
            venue_obj = item.get("venue") or {}
            league_obj = item.get("league") or {}
            div_obj = item.get("division") or {}

            # Athletics(133)의 경우 API가 locationName을 비워두거나 구단명을 'Athletics'로 내려줌
            api_name = str(item.get("name") or "").strip()
            if tid == 133 and "oakland" in api_name.lower():
                api_name = "Athletics"

            api_code = str(item.get("abbreviation") or "").strip().upper()
            api_city = str(item.get("locationName") or item.get("franchiseName") or "").strip()
            api_stadium = str(venue_obj.get("name") or "").strip()

            merged_map[tid] = {
                "team_id": tid,
                "team_name": api_name or fb["team_name"],
                "team_code": api_code or fb["team_code"],
                "league": _parse_league_abbr(league_obj, fb["league"]),
                "division": _parse_division_short(div_obj, fb["division"]),
                "city": api_city or fb["city"],
                "stadium": api_stadium or fb["stadium"],
                "logo_url": f"https://www.mlbstatic.com/team-logos/{tid}.svg",
            }
            online_updated += 1

        print(f" -> [온라인 동기화 성공] MLB 공식 API에서 {online_updated}개 구단 최신 정보를 가져왔습니다.")
        return list(merged_map.values())

    except Exception as e:
        print(f" ※ [Fallback 모드] MLB API 구단 조회 실패 ({e}) -> 내장 최신 데이터를 사용합니다.")
        return list(fallback_map.values())


def seed_teams():
    print(">>> MLB 30개 구단 데이터 동기화 시작 (온라인 API 우선 + Fallback 보장)...")
    teams_to_save = fetch_teams_with_fallback()

    sql = text("""
        INSERT INTO teams (team_id, team_name, team_code, league, division, city, stadium, logo_url)
        VALUES (:team_id, :team_name, :team_code, :league, :division, :city, :stadium, :logo_url)
        ON DUPLICATE KEY UPDATE
            team_name = VALUES(team_name),
            team_code = VALUES(team_code),
            league = VALUES(league),
            division = VALUES(division),
            city = VALUES(city),
            stadium = VALUES(stadium),
            logo_url = VALUES(logo_url);
    """)

    with engine.begin() as conn:
        conn.execute(sql, teams_to_save)

    print(f">>> MLB {len(teams_to_save)}개 구단 최신 정보 DB 적재 완료!")


if __name__ == "__main__":
    seed_teams()