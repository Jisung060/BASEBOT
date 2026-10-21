"""Official-first source selection; no live DB or network requests."""
import ast
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import numpy as np
import pandas as pd
import requests

BACK = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACK))
from scripts import collector_stat_sources as sources
from scripts import collector_savant_value_repair as repair


def prepare(role, mlb, published, war, pct, discipline=None):
    filename = f'collector_{role}s_integrated.py'
    name = f'collect_{role}s_comprehensive'
    tree = ast.parse((BACK / 'scripts' / filename).read_text(encoding='utf-8'))
    fn = next(n for n in tree.body if getattr(n, 'name', '') == name)
    # Execute the actual fetch/merge/fallback block, stopping before DB writes.
    stop = next(i for i,n in enumerate(fn.body) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name) and n.value.func.id == 'ensure_provenance_table')
    fn.body = fn.body[:stop] + [ast.Return(value=ast.Name(id='df', ctx=ast.Load()))]
    ast.fix_missing_locations(fn)
    env = dict(pd=pd, np=np, HEADERS={}, fetch_bref_war=Mock(return_value=war),
               fetch_official_percentiles=Mock(return_value=pct),
               overlay_official_percentiles=sources.overlay_official_percentiles)
    env[f'fetch_mlb_{role}s'] = Mock(return_value=mlb)
    env[f'fetch_fangraphs_{role}s'] = Mock(return_value=published)
    env['fetch_savant_statcast_all' if role=='batter' else 'fetch_savant_pitcher_statcast'] = Mock(return_value=pd.DataFrame())
    env[f'fetch_savant_{role}_discipline'] = Mock(return_value=discipline if discipline is not None else pd.DataFrame())
    exec(compile(ast.Module(body=[fn],type_ignores=[]), filename, 'exec'),env)
    return env[name](2025).set_index('player_id')


class OfficialFirstTests(unittest.TestCase):
    def test_batter_published_zero_and_missing_fallback(self):
        mlb = pd.DataFrame([dict(player_id=i, ops=.8,obp=.35,slg=.45,at_bats=100,walks=10,strikeouts=20,plate_appearances=120) for i in (1,2)])
        published = pd.DataFrame([dict(player_id=1, wrc_plus=0, fwar=0)])
        war = pd.DataFrame([dict(player_id=1,bwar=0)])
        pct = pd.DataFrame([dict(player_id=1,exit_velo_percentile=0)])
        disc = pd.DataFrame([dict(player_id=1,k_percentage=0,bb_percentage=12.3)])
        result = prepare('batter',mlb,published,war,pct,disc)
        for field in ('wrc_plus','bwar','fwar','k_percentage','exit_velo_percentile'):
            self.assertEqual(result.loc[1,field],0)
        self.assertEqual(result.loc[1,'bb_percentage'],12.3)
        self.assertEqual(result.loc[2,'k_percentage'],16.7)
        self.assertIsNotNone(result.loc[2,'fwar'])

    def test_pitcher_official_priority_and_fip_uses_thirds(self):
        mlb = pd.DataFrame([dict(player_id=i,innings_pitched=10.2,home_runs_allowed=2,walks=5,hit_by_pitch=0,strikeouts=8,era=4.0) for i in (1,2)])
        result = prepare('pitcher',mlb,pd.DataFrame([dict(player_id=1,fip=0,fwar=0)]),
                         pd.DataFrame([dict(player_id=1,bwar=7.5)]),
                         pd.DataFrame([dict(player_id=1,xwoba_percentile=0)]))
        self.assertEqual(result.loc[1,'fip'],0)
        self.assertEqual(result.loc[1,'fwar'],0)
        self.assertEqual(result.loc[1,'bwar'],7.5)
        self.assertEqual(result.loc[1,'xwoba_percentile'],0)
        self.assertEqual(result.loc[2,'fip'],round((26+15-16)/(10+2/3)+3.1,2))

    def test_published_percentiles_invalid_or_missing_keep_estimates(self):
        base = pd.DataFrame({'player_id':[1,2,3], 'k_percentile':[40,50,60]})
        official = pd.DataFrame({'player_id':[1,2,3], 'k_percentile':[0,None,101]})
        self.assertEqual(sources.overlay_official_percentiles(base,official).k_percentile.tolist(),[0,50,60])

    def test_bref_filters_season_and_does_not_double_count_totals(self):
        csv = 'mlb_ID,year_ID,team_ID,stint_ID,WAR\n1,2025,AAA,1,1.0\n1,2025,BBB,2,2.0\n1,2025,TOT,0,3.0\n2,2025,AAA,1,-1.2\n2,2025,BBB,2,0.2\n3,2024,AAA,1,9\n'
        response=Mock(text=csv)
        with patch.object(sources.requests,'get',return_value=response), patch.object(sources,'fetch_pybaseball_stats',return_value=pd.DataFrame()):
            result=sources.fetch_bref_war(2025,False,{}).set_index('player_id')
        self.assertEqual(result.loc[1,'bwar'],3)
        self.assertEqual(result.loc[2,'bwar'],-1)
        self.assertNotIn(3,result.index)

    def test_bref_failure_returns_empty_for_fallback(self):
        with patch.object(sources.requests,'get',side_effect=requests.HTTPError('403')), patch.object(sources,'fetch_pybaseball_stats',return_value=pd.DataFrame()):
            self.assertTrue(sources.fetch_bref_war(2025,True,{}).empty)

    def test_fangraphs_missing_fields_are_not_fabricated_as_zero(self):
        for role in ('batter','pitcher'):
            file=BACK/'scripts'/f'collector_{role}s_integrated.py'
            name=f'_fetch_fangraphs_{role}s_http'
            fn=next(n for n in ast.parse(file.read_text(encoding='utf-8')).body if getattr(n,'name','')==name)
            response=Mock(status_code=200)
            response.json.return_value={'data':[{'xMLBAMID':'1'}, {'xMLBAMID':'2','WAR':0,'wRC+':0,'FIP':0}]}
            env=dict(pd=pd,np=np,HEADERS={},requests=Mock())
            env['requests'].get.return_value=response
            exec(compile(ast.Module(body=[fn],type_ignores=[]),str(file),'exec'),env)
            result=env[name](2025).set_index('player_id')
            self.assertTrue(pd.isna(result.loc[1,'fwar']))
            self.assertEqual(result.loc[2,'fwar'],0)
            metric='wrc_plus' if role=='batter' else 'fip'
            self.assertTrue(pd.isna(result.loc[1,metric]))
            self.assertEqual(result.loc[2,metric],0)

    def test_official_pitcher_xera_and_zero_percentiles(self):
        frame = pd.DataFrame({'player_id':[1], 'xera':[0], 'xwoba':[55], 'k_percent':[0]})
        with patch.object(repair,'safe_csv_get',return_value=frame):
            result=repair.fetch_official_percentiles(2025,'pitcher').iloc[0]
        self.assertEqual(result['xwoba_percentile'],0)
        self.assertEqual(result['k_percentile'],0)

    def test_merge_does_not_drop_official_only_players(self):
        a=pd.DataFrame({'player_id':[1],'k_percentile':[25]})
        b=pd.DataFrame({'player_id':[2],'k_percentile':[0]})
        result=repair.merge_frames([a,b]).set_index('player_id')
        self.assertEqual(set(result.index),{1,2})
        self.assertEqual(result.loc[2,'k_percentile'],0)

    def test_display_preserves_saved_percentiles_including_zero(self):
        tree=ast.parse((BACK/'routers/players.py').read_text(encoding='utf-8'))
        fn=next(n for n in tree.body if getattr(n,'name','')=='get_player_detail')
        # Isolate the actual percentile block from endpoint authentication/DB setup.
        loop=next(n for n in fn.body if isinstance(n,ast.For) and isinstance(n.iter,ast.Name) and n.iter.id=='all_stats')
        branch=next(n for n in loop.body if isinstance(n,ast.If) and isinstance(n.test,ast.UnaryOp))
        keys={n.slice.value for n in ast.walk(branch) if isinstance(n,ast.Subscript) and isinstance(n.value,ast.Name) and n.value.id=='item' and isinstance(n.slice,ast.Constant)}
        for is_pitcher in (False,True):
            item={key:0 for key in keys}
            env=dict(item=item,is_pit=is_pitcher,dist={},batting_stats=[],pitching_stats=[],calc_empirical_percentile=Mock(return_value=55))
            exec(compile(ast.Module(body=[branch],type_ignores=[]),'percentile_block','exec'),env)
            self.assertEqual(item['xwoba_percentile'],0)
            env['calc_empirical_percentile'].assert_not_called()
            item['xwoba_percentile']=None
            exec(compile(ast.Module(body=[branch],type_ignores=[]),'percentile_block','exec'),env)
            self.assertEqual(item['xwoba_percentile'],55)

if __name__=='__main__':
    unittest.main()
