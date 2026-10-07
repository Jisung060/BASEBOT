import os
import sys
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

from sqlalchemy import text
from database.db_connection import engine

TEAMS_DATA = [
    # AL East
    (110, 'Baltimore Orioles', 'BAL', 'AL', 'East', 'Baltimore', 'Oriole Park at Camden Yards', 'https://www.mlbstatic.com/team-logos/110.svg'),
    (111, 'Boston Red Sox', 'BOS', 'AL', 'East', 'Boston', 'Fenway Park', 'https://www.mlbstatic.com/team-logos/111.svg'),
    (147, 'New York Yankees', 'NYY', 'AL', 'East', 'New York', 'Yankee Stadium', 'https://www.mlbstatic.com/team-logos/147.svg'),
    (139, 'Tampa Bay Rays', 'TB', 'AL', 'East', 'St. Petersburg', 'Tropicana Field', 'https://www.mlbstatic.com/team-logos/139.svg'),
    (141, 'Toronto Blue Jays', 'TOR', 'AL', 'East', 'Toronto', 'Rogers Centre', 'https://www.mlbstatic.com/team-logos/141.svg'),

    # AL Central
    (145, 'Chicago White Sox', 'CWS', 'AL', 'Central', 'Chicago', 'Guaranteed Rate Field', 'https://www.mlbstatic.com/team-logos/145.svg'),
    (114, 'Cleveland Guardians', 'CLE', 'AL', 'Central', 'Cleveland', 'Progressive Field', 'https://www.mlbstatic.com/team-logos/114.svg'),
    (116, 'Detroit Tigers', 'DET', 'AL', 'Central', 'Detroit', 'Comerica Park', 'https://www.mlbstatic.com/team-logos/116.svg'),
    (118, 'Kansas City Royals', 'KC', 'AL', 'Central', 'Kansas City', 'Kauffman Stadium', 'https://www.mlbstatic.com/team-logos/118.svg'),
    (142, 'Minnesota Twins', 'MIN', 'AL', 'Central', 'Minneapolis', 'Target Field', 'https://www.mlbstatic.com/team-logos/142.svg'),

    # AL West
    (117, 'Houston Astros', 'HOU', 'AL', 'West', 'Houston', 'Minute Maid Park', 'https://www.mlbstatic.com/team-logos/117.svg'),
    (108, 'Los Angeles Angels', 'LAA', 'AL', 'West', 'Anaheim', 'Angel Stadium', 'https://www.mlbstatic.com/team-logos/108.svg'),
    (133, 'Oakland Athletics', 'OAK', 'AL', 'West', 'Sacramento', 'Sutter Health Park', 'https://www.mlbstatic.com/team-logos/133.svg'),
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

def seed_teams():
    print(">>> MLB 30개 구단 데이터 초기 적재 시작...")
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
        for t in TEAMS_DATA:
            conn.execute(sql, {
                'team_id': t[0],
                'team_name': t[1],
                'team_code': t[2],
                'league': t[3],
                'division': t[4],
                'city': t[5],
                'stadium': t[6],
                'logo_url': t[7]
            })
    print(">>> MLB 30개 구단 적재 완료!")

if __name__ == "__main__":
    seed_teams()