"""Player source labels follow persisted provenance without writing to the database."""
import ast
from datetime import date
import math
from pathlib import Path
import unittest
from unittest.mock import Mock
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

FILE=Path(__file__).resolve().parents[2]/'routers/players.py'
NAMES={'get_player_provenance','player_stat_sources','get_player_detail'}
TREE=ast.Module(body=[n for n in ast.parse(FILE.read_text(encoding='utf-8')).body if getattr(n,'name',None) in NAMES],type_ignores=[])
for node in TREE.body:node.decorator_list=[]
ENV=dict(math=math,inspect=inspect,text=text,Session=Session,Depends=lambda fn:None,get_session=lambda:None,
         get_season_distribution=lambda *args:[],calc_empirical_percentile=lambda *args:None,
         calculate_age=lambda value:'-',format_height_weight=lambda *args:dict(height_display='-',weight_display='-',physical_display='-'))
exec(compile(TREE,str(FILE),'exec'),ENV)


class PlayerSourceTests(unittest.TestCase):
    def test_metric_labels_include_estimated_and_provider(self):
        item={'season':2025,'is_pitcher':False,'bwar':0,'fwar':8,'wrc_plus':242}
        records={(2025,False,'bwar'):{'source':'estimated','stored_value':0},
                 (2025,False,'fwar'):{'source':'fangraphs_pybaseball','stored_value':8},
                 (2025,False,'wrc_plus'):{'source':'local_csv:fangraphs_batting_2025.csv','stored_value':242}}
        result=ENV['player_stat_sources'](item,records)
        self.assertEqual(result['bwar']['label'],'추정값 · 자체 계산')
        self.assertEqual(result['fwar']['label'],'FanGraphs · 온라인 원본')
        self.assertEqual(result['wrc_plus']['label'],'FanGraphs · 원본 CSV')
        item['bwar']=-1
        records[(2025,False,'bwar')]={'source':'baseball_reference_http','stored_value':-1}
        self.assertEqual(ENV['player_stat_sources'](item,records)['bwar']['label'],'Baseball-Reference · 온라인 원본')

    def test_unknown_stale_wrong_provider_and_wrong_role_never_claim_original(self):
        item={'season':2025,'is_pitcher':True,'bwar':2,'fwar':3,'wrc_plus':None}
        for origin in (None,{'source':'legacy_unknown','stored_value':3}, {'source':'fangraphs_http','stored_value':9},
                       {'source':'local_csv:fangraphs_batting_2025.csv','stored_value':3},
                       {'source':'local_csv:fangraphs_pitching_2024.csv','stored_value':3},
                       {'source':'baseball_reference_http','stored_value':3}):
            records={(2025,True,'fwar'):origin} if origin else {}
            result=ENV['player_stat_sources'](item,records)
            self.assertEqual(result['fwar']['status'],'unknown')
            self.assertEqual(result['fwar']['label'],'원본 미확보 · 기존 값 유지')
            self.assertEqual(result['wrc_plus']['status'],'missing')

    def test_actual_endpoint_with_two_roles_seasons_and_missing_provenance_table(self):
        engine=create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE teams (team_id INT, team_name TEXT, team_code TEXT)'))
            conn.execute(text('CREATE TABLE players (player_id INT, player_name TEXT, team_id INT, headshot_url TEXT, jersey_number INT, position TEXT, birth_date TEXT, bats TEXT, throws TEXT, height TEXT, weight INT)'))
            conn.execute(text("INSERT INTO players VALUES (1,'Test',147,NULL,1,'P',NULL,'L','R',NULL,NULL)"))
            conn.execute(text("INSERT INTO teams VALUES (147,'Yankees','NYY')"))
            conn.execute(text('CREATE TABLE player_season_stats (player_id INT, season INT, is_pitcher BOOL, team_id INT, games INT, bwar FLOAT, fwar FLOAT, wrc_plus FLOAT)'))
            conn.execute(text('INSERT INTO player_season_stats VALUES (1,2025,0,147,100,2,3,120),(1,2025,1,147,30,4,5,NULL),(1,2024,0,147,90,1,2,110)'))
        with Session(engine) as session:
            response=ENV['get_player_detail'](1,session)
            self.assertEqual(response['batting_stats'][0]['stat_sources']['fwar']['status'],'unknown')
            self.assertFalse(inspect(engine).has_table('player_stat_provenance'))
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE player_stat_provenance (player_id INT,season INT,is_pitcher BOOL,metric TEXT,source TEXT,stored_value FLOAT)'))
            conn.execute(text("INSERT INTO player_stat_provenance VALUES (1,2025,0,'fwar','estimated',3),(1,2025,1,'fwar','fangraphs_http',5),(1,2024,0,'fwar','local_csv:fangraphs_batting_2024.csv',2),(2,2025,0,'bwar','estimated',2)"))
        with Session(engine) as session:
            response=ENV['get_player_detail'](1,session)
        self.assertEqual(response['batting_stats'][0]['stat_sources']['fwar']['status'],'estimated')
        self.assertEqual(response['pitching_stats'][0]['stat_sources']['fwar']['status'],'published')
        self.assertEqual(response['batting_stats'][1]['stat_sources']['fwar']['label'],'FanGraphs · 원본 CSV')
        self.assertEqual(response['batting_stats'][0]['stat_sources']['bwar']['status'],'unknown')
        self.assertEqual(response['batting_stats'][0]['fwar'],3)

if __name__=='__main__':unittest.main()
