"""Expanded snapshots preserve original metrics and work without network access."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts import prepare_source_csvs as prepare
from scripts import collector_stat_sources as sources
from scripts import import_source_csvs as loader


class ExpansionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        for module in (prepare,sources):
            patcher=patch.object(module,'SOURCE_DIR',self.folder)
            patcher.start();self.addCleanup(patcher.stop)

    def spec(self,name):
        return next(s for s in prepare.source_specs(2025) if s['name']==name)

    def test_only_oaa_accepts_empty_year_but_never_wrong_year(self):
        spec=self.spec('savant_oaa')
        prepare.validate_csv(b'player_id,year,outs_above_average\n1,,0\n',spec)
        with self.assertRaises(ValueError):
            prepare.validate_csv(b'player_id,year,outs_above_average\n1,2024,0\n',spec)
        with self.assertRaises(ValueError):
            prepare.validate_csv(b'player_id,year,k_percent\n1,,0\n',self.spec('savant_percentiles_batter'))

    def test_mlb_published_stats_saved_and_roundtrip_without_estimates(self):
        for pitcher in (False,True):
            stat={'gamesPlayed':12,'inningsPitched':'10.2','era':'3.00','homeRuns':2,'baseOnBalls':0} if pitcher else {'gamesPlayed':12,'atBats':25,'avg':'.320','homeRuns':2,'baseOnBalls':0}
            payload={'stats':[{'splits':[{'season':'2025','player':{'id':1,'fullName':'Test'},'team':{'id':147},'stat':stat}]}]}
            with patch.object(sources.requests,'get',return_value=Mock(json=lambda:payload)):
                sources.fetch_mlb_season_payload(2025,pitcher)
            spec=self.spec('mlb_pitching' if pitcher else 'mlb_batting')
            path=self.folder/spec['filename']; data=path.read_bytes(); metadata=path.with_suffix('.meta.json').read_bytes()
            with patch.object(sources.requests,'get',side_effect=requests.ConnectionError('offline')):
                result=sources.fetch_mlb_season_payload(2025,pitcher)
            stats=result['stats'][0]['splits'][0]['stat']
            self.assertEqual(float(stats['homeRuns']),2)
            self.assertEqual(float(stats['baseOnBalls']),0)
            if pitcher:self.assertEqual(str(stats['inningsPitched']),'10.2')
            self.assertEqual(path.read_bytes(),data)
            self.assertEqual(path.with_suffix('.meta.json').read_bytes(),metadata)
            mapped=loader.map_snapshot(prepare.read_prepared(spec),spec,pitcher)
            self.assertEqual(mapped.iloc[0]['home_runs_allowed' if pitcher else 'home_runs'],2)
            self.assertNotIn('home_runs' if pitcher else 'home_runs_allowed',mapped)
            self.assertNotIn('fwar',mapped)

    def test_savant_online_save_then_offline_registered_lookup(self):
        for name,metric in [('savant_oaa','outs_above_average'),('savant_baserunning','runner_runs_tot'),('savant_arm_strength','arm_overall'),('savant_catcher_blocking','diff_runner_pb_wp'),('savant_catcher_throwing','cs_above_average'),('savant_catcher_poptime','pop_2b_sba')]:
            spec=self.spec(name)
            response=Mock(text=f'player_id,{metric}\n1,0\n')
            with patch.object(sources.requests,'get',return_value=response):
                sources.request_csv(spec['url'],params=spec['params'])
            self.assertTrue((self.folder/spec['filename']).exists(),name)
            with patch.object(sources.requests,'get',side_effect=requests.ConnectionError('offline')):
                result=sources.request_csv(spec['url'],params=spec['params'])
            self.assertEqual(result.stat_source,f"local_csv:{spec['filename']}")

    def test_catcher_cs_does_not_override_dedicated_arm_or_poptime(self):
        frame=pd.DataFrame({'id':[1],'cs_above_average':[2],'arm_strength':[99],'pop_time':[1.9]})
        result=loader.map_snapshot(frame,self.spec('savant_catcher_throwing'),False)
        self.assertEqual(result.iloc[0].cs_above_average,2)
        self.assertNotIn('arm_strength',result)
        self.assertNotIn('pop_time',result)

    def test_mlb_total_failure_remains_fallback_compatible_valueerror(self):
        with patch.object(sources.requests,'get',side_effect=requests.ConnectionError('offline')):
            with self.assertRaises(ValueError):sources.fetch_mlb_season_payload(2025,False)

    def test_no_per_player_extension_requests_in_registry(self):
        self.assertFalse(any('/savant-player/' in s['url'] for s in prepare.source_specs(2025)))

if __name__=='__main__':unittest.main()
