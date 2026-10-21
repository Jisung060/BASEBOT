"""Local fallback and provenance tests: no provider requests or live DB writes."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import pandas as pd
import requests
import subprocess

BACK = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACK))
from scripts import collector_stat_sources as sources
from scripts import stat_provenance as provenance
from scripts import collector_savant_value_repair as repair

class SourceFallbackTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.patcher = patch.object(sources, 'SOURCE_DIR', self.folder)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_pybaseball_success_does_not_call_http(self):
        online = pd.DataFrame({'player_id':[1], 'fwar':[0], 'wrc_plus':[120],
                               'fwar__source':['fangraphs_pybaseball'], 'wrc_plus__source':['fangraphs_pybaseball']})
        http=Mock()
        with patch.object(sources,'fetch_pybaseball_stats',return_value=online):
            result=sources.fetch_fangraphs_with_fallback(2025,False,http)
        http.assert_not_called()
        self.assertEqual(result.iloc[0].fwar,0)

    def test_failed_online_uses_local_original_with_zero(self):
        pd.DataFrame({'player_id':[1,2], 'Season':[2025,2024], 'WAR':[0,9], 'wRC+':[130,200]}).to_csv(self.folder/'fangraphs_batting_2025.csv',index=False)
        with patch.object(sources,'fetch_pybaseball_stats',return_value=pd.DataFrame()):
            result=sources.fetch_fangraphs_with_fallback(2025,False,Mock(return_value=pd.DataFrame(columns=['player_id','fwar','wrc_plus'])))
        self.assertEqual(result.player_id.tolist(),[1])
        self.assertEqual(result.iloc[0].fwar,0)
        self.assertTrue(result.iloc[0]['fwar__source'].startswith('local_csv:'))

    def test_local_originals_take_priority_over_online_values(self):
        pd.DataFrame({'player_id':[1,2], 'WAR':[4,5], 'wRC+':[120,110]}).to_csv(self.folder/'fangraphs_batting_2025.csv',index=False)
        online=pd.DataFrame({'player_id':[1], 'fwar':[0], 'wrc_plus':[None], 'fwar__source':['fangraphs_pybaseball']})
        with patch.object(sources,'fetch_pybaseball_stats',return_value=online):
            result=sources.fetch_fangraphs_with_fallback(2025,False,Mock(return_value=pd.DataFrame(columns=['player_id','fwar','wrc_plus']))).set_index('player_id')
        self.assertEqual(result.loc[1,'fwar'],4)
        self.assertEqual(result.loc[1,'wrc_plus'],120)
        self.assertEqual(result.loc[2,'fwar'],5)
        self.assertEqual(result.loc[1,'fwar__source'],'local_csv:fangraphs_batting_2025.csv')

    def test_bref_local_fallback_and_season_filter(self):
        pd.DataFrame({'mlb_ID':[1,2], 'year_ID':[2025,2024], 'WAR':[0,5], 'team_ID':['AAA','BBB']}).to_csv(self.folder/'bref_pitching_2025.csv',index=False)
        with patch.object(sources,'fetch_pybaseball_stats',return_value=pd.DataFrame()), patch.object(sources.requests,'get',side_effect=requests.HTTPError('403')):
            result=sources.fetch_bref_war(2025,True,{})
        self.assertEqual(result.player_id.tolist(),[1])
        self.assertEqual(result.iloc[0].bwar,0)
        self.assertIn('local_csv:', result.iloc[0]['bwar__source'])

    def test_local_idfg_requires_explicit_crosswalk(self):
        pd.DataFrame({'IDfg':[10], 'WAR':[3], 'wRC+':[125]}).to_csv(self.folder/'fangraphs_batting_2025.csv',index=False)
        self.assertTrue(sources.read_local_stats('fangraphs',2025,False).empty)
        pd.DataFrame({'key_fangraphs':[10], 'key_mlbam':[100]}).to_csv(self.folder/'player_id_map.csv',index=False)
        self.assertEqual(sources.read_local_stats('fangraphs',2025,False).iloc[0].player_id,100)

    def test_duplicate_or_invalid_ids_are_not_silently_matched(self):
        with self.assertRaises(ValueError):
            sources.normalize_fangraphs(pd.DataFrame({'player_id':[1,1],'WAR':[2,3]}),2025,False,'local')
        result=sources.normalize_fangraphs(pd.DataFrame({'player_id':[-1,1.5],'WAR':[2,3]}),2025,False,'local')
        self.assertTrue(result.empty)

    def test_lahman_basic_fallback_uses_crosswalk_and_excludes_other_leagues(self):
        folder=self.folder/'lahman';folder.mkdir()
        pd.DataFrame({'playerID':['lahman1'], 'bbrefID':['ref1'], 'nameFirst':['A'], 'nameLast':['Player']}).to_csv(folder/'People.csv',index=False)
        pd.DataFrame({'key_bbref':['ref1'], 'key_mlbam':[100]}).to_csv(self.folder/'player_id_map.csv',index=False)
        batting=dict(playerID='lahman1',yearID=2025,lgID='AL',G=10,AB=30,H=10,HR=1,RBI=3,SB=1,BB=2,SO=4,HBP=0,SH=0,SF=1)
        batting.update({'2B':2,'3B':0})
        excluded={**batting,'lgID':'NNL','AB':1000}
        pd.DataFrame([batting,excluded]).to_csv(folder/'Batting.csv',index=False)
        result=sources.read_lahman_basics(2025,False).iloc[0]
        self.assertEqual(result.player_id,100)
        self.assertEqual(result.at_bats,30)
        self.assertEqual(result.batting_avg,.333)
        self.assertIsNone(result.team_id)
        pitching=dict(playerID='lahman1',yearID=2025,lgID='AL',G=3,W=1,L=0,IPouts=32,SO=12,BB=2,HBP=0,HR=1,H=7,ER=3)
        pd.DataFrame([pitching]).to_csv(folder/'Pitching.csv',index=False)
        result=sources.read_lahman_basics(2025,True).iloc[0]
        self.assertEqual(result.innings_pitched,10.2)
        self.assertEqual(result.era,2.53)

    def test_pybaseball_fangraphs_ids_are_resolved_not_guessed(self):
        from types import SimpleNamespace
        fake=SimpleNamespace(batting_stats=Mock(return_value=pd.DataFrame({'IDfg':[7], 'Season':[2025], 'WAR':[2.3], 'wRC+':[120]})),
                             playerid_reverse_lookup=Mock(return_value=pd.DataFrame({'key_fangraphs':[7], 'key_mlbam':[100]})))
        with patch.dict(sys.modules,{'pybaseball':fake}):
            result=sources._query_pybaseball_stats(2025,False,'fangraphs')
        self.assertEqual(result.iloc[0].player_id,100)
        self.assertEqual(result.iloc[0]['fwar__source'],'fangraphs_pybaseball')
        fake.batting_stats.assert_called_once_with(2025,2025,qual=0)
        fake.playerid_reverse_lookup.assert_called_once_with([7],key_type='fangraphs')

    def test_pybaseball_timeout_returns_control_for_fallback(self):
        with patch.object(sources.subprocess,'run',side_effect=subprocess.TimeoutExpired('pybaseball',30)) as run:
            self.assertTrue(sources.fetch_pybaseball_stats(2025,False,'fangraphs').empty)
        self.assertEqual(run.call_args.kwargs['timeout'],30)

    def test_savant_local_percentiles_after_online_failure(self):
        pd.DataFrame({'player_id':[1], 'year':[2025], 'k_percent':[0]}).to_csv(self.folder/'savant_percentiles_batter_2025.csv',index=False)
        with patch.object(repair,'SOURCE_DIR',self.folder),patch.object(repair,'safe_csv_get',return_value=pd.DataFrame()):
            result=repair.fetch_official_percentiles(2025,'batter')
        self.assertEqual(result.iloc[0].k_percentile,0)
        self.assertIn('local_csv:',result.iloc[0]['k_percentile__source'])

class ProvenanceTests(unittest.TestCase):
    def test_verified_original_values_survive_estimates(self):
        for old,source in [(0,'savant_csv'),(4.2,'local_csv:a.csv')]:
            value,origin,accepted=provenance.choose_stat(old,source,99,'estimated')
            self.assertEqual(value,old)
            self.assertFalse(accepted)
            self.assertEqual(origin,source or 'legacy_unknown')

    def test_new_original_replaces_estimate_and_unknown(self):
        for source in ('estimated',None):
            self.assertEqual(provenance.choose_stat(5,source,0,'fangraphs_pybaseball'),(0,'fangraphs_pybaseball',True))
        self.assertEqual(provenance.choose_stat(1,'estimated',2,'estimated'),(1,'estimated',False))

    def test_first_estimate_is_saved_and_later_estimates_keep_value_and_source(self):
        self.assertEqual(provenance.choose_stat(None,None,2,'estimated'),(2,'estimated',True))
        self.assertEqual(provenance.choose_stat(2,'estimated',9,'estimated'),(2,'estimated',False))
        self.assertEqual(provenance.choose_stat(2,None,9,'estimated'),(9,'estimated',True))
        self.assertEqual(provenance.choose_stat(2,'estimated',3,'fangraphs_http'),(3,'fangraphs_http',True))

    def test_preserved_known_estimate_metadata_is_not_rewritten(self):
        for source in ('estimated',):
            conn=Mock()
            existing=Mock();existing.mappings.return_value.all.return_value=[{'player_id':1,'fwar':2}]
            metadata=Mock();metadata.mappings.return_value.all.return_value=[{'player_id':1,'metric':'fwar','source':source,'stored_value':2}]
            conn.execute.side_effect=[existing,metadata]
            result,records=provenance.protect_derived_stats(conn,pd.DataFrame({'player_id':[1],'fwar':[9],'fwar__source':['estimated']}),2025,False,['fwar'])
            self.assertEqual(result.iloc[0].fwar,2)
            self.assertEqual(records,[])

    def test_unknown_values_are_revalidated_even_if_same_as_calculation(self):
        for old_value in (2,9):
            for old_source in (None,'legacy_unknown'):
                conn=Mock()
                existing=Mock();existing.mappings.return_value.all.return_value=[{'player_id':1,'fwar':old_value}]
                metadata=Mock();metadata.mappings.return_value.all.return_value=[] if old_source is None else [{'player_id':1,'metric':'fwar','source':old_source,'stored_value':old_value}]
                conn.execute.side_effect=[existing,metadata]
                result,records=provenance.protect_derived_stats(conn,pd.DataFrame({'player_id':[1],'fwar':[9],'fwar__source':['estimated']}),2025,False,['fwar'])
                self.assertEqual(result.iloc[0].fwar,9)
                self.assertEqual(records[0]['source'],'estimated')
                self.assertEqual(records[0]['value'],9)

    def test_guard_keeps_original_and_records_new_original(self):
        conn=Mock()
        existing=Mock();existing.mappings.return_value.all.return_value=[{'player_id':1,'bwar':0,'fwar':1}]
        metadata=Mock();metadata.mappings.return_value.all.return_value=[{'player_id':1,'metric':'bwar','source':'baseball_reference_pybaseball','stored_value':0}]
        conn.execute.side_effect=[existing,metadata]
        frame=pd.DataFrame({'player_id':[1],'bwar':[9],'bwar__source':['estimated'],'fwar':[0],'fwar__source':['local_csv:fg.csv']})
        result,records=provenance.protect_derived_stats(conn,frame,2025,False,['bwar','fwar'])
        self.assertEqual(result.iloc[0].bwar,0)
        self.assertEqual(result.iloc[0].fwar,0)
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['source'],'local_csv:fg.csv')
        self.assertIn('FOR UPDATE',str(conn.execute.call_args_list[0].args[0]))

    def test_external_modified_value_is_replaced_with_verified_calculation(self):
        conn=Mock()
        existing=Mock();existing.mappings.return_value.all.return_value=[{'player_id':1,'bwar':5}]
        metadata=Mock();metadata.mappings.return_value.all.return_value=[{'player_id':1,'metric':'bwar','source':'estimated','stored_value':1}]
        conn.execute.side_effect=[existing,metadata]
        result,records=provenance.protect_derived_stats(conn,pd.DataFrame({'player_id':[1],'bwar':[9]}),2025,False,['bwar'])
        self.assertEqual(result.iloc[0].bwar,9)
        self.assertEqual(records[0]['source'],'estimated')

if __name__=='__main__':
    unittest.main()
