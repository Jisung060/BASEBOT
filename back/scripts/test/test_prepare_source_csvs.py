"""Source preparation validates before replacement; no network/DB needed."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import pandas as pd
import requests

BACK=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(BACK))
from scripts import prepare_source_csvs as prepare
from scripts import collector_stat_sources as sources

class PrepareCSVTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.directory.cleanup)
        self.folder=Path(self.directory.name)
        self.patch=patch.object(prepare,'SOURCE_DIR',self.folder)
        self.patch.start();self.addCleanup(self.patch.stop)
        self.spec=next(s for s in prepare.source_specs(2025) if s['name']=='savant_percentiles_batter')
        self.data=b'player_id,year,k_percent\n1,2025,0\n'

    def response(self,data=None):
        response=Mock()
        response.iter_content.return_value=[self.data if data is None else data]
        return response

    def download(self,force=False):
        with patch.object(prepare.requests,'get',return_value=self.response()):
            return prepare.download_one(self.spec,force)

    def test_download_and_metadata_then_reuse_without_network(self):
        self.assertEqual(self.download()['status'],'downloaded')
        self.assertEqual(prepare.read_prepared(self.spec).iloc[0].k_percent,0)
        with patch.object(prepare.requests,'get') as get:
            self.assertEqual(prepare.download_one(self.spec)['status'],'cached')
        get.assert_not_called()
        self.assertTrue((self.folder/self.spec['filename']).with_suffix('.meta.json').exists())

    def test_invalid_csv_and_failed_refresh_preserve_good_file(self):
        self.download()
        original=(self.folder/self.spec['filename']).read_bytes()
        for bad in (b'<html>error</html>',b'player_id,year,k_percent\n1,2024,80\n',b'player_id,year,k_percent\n1,2025,\n'):
            with patch.object(prepare.requests,'get',return_value=self.response(bad)):
                self.assertEqual(prepare.download_one(self.spec,True)['status'],'failed')
            self.assertEqual((self.folder/self.spec['filename']).read_bytes(),original)

    def test_failed_metadata_replacement_restores_previous_snapshot(self):
        self.download()
        old=(self.folder/self.spec['filename']).read_bytes()
        import os
        replace=os.replace
        def fail_metadata(src,dst):
            if str(dst).endswith('.meta.json'):
                raise OSError('metadata write failed')
            return replace(src,dst)
        new=b'player_id,year,k_percent\n1,2025,90\n'
        with patch.object(prepare.requests,'get',return_value=self.response(new)), patch.object(prepare.os,'replace',side_effect=fail_metadata):
            self.assertEqual(prepare.download_one(self.spec,True)['status'],'failed')
        self.assertEqual((self.folder/self.spec['filename']).read_bytes(),old)
        self.assertEqual(prepare.read_prepared(self.spec).iloc[0].k_percent,0)

    def test_http_403_does_not_create_csv(self):
        response=self.response();response.raise_for_status.side_effect=requests.HTTPError('403')
        with patch.object(prepare.requests,'get',return_value=response):
            self.assertEqual(prepare.download_one(self.spec)['status'],'failed')
        self.assertFalse((self.folder/self.spec['filename']).exists())

    def test_corrupt_file_fails_checksum(self):
        self.download()
        (self.folder/self.spec['filename']).write_bytes(b'player_id,year,k_percent\n1,2025,99\n')
        with self.assertRaises(ValueError):prepare.read_prepared(self.spec)

    def test_online_failure_reads_exact_registered_snapshot(self):
        self.download()
        with patch.object(sources.requests,'get',side_effect=requests.ConnectionError('offline')):
            response=sources.request_csv(self.spec['url'],params=self.spec['params'])
        self.assertIn('local_csv:',response.stat_source)
        self.assertIn('2025',response.text)

    def test_range_and_bat_tracking_start(self):
        with self.assertRaises(ValueError):prepare.source_specs(2014)
        self.assertFalse(any(s['name']=='savant_bat_tracking' for s in prepare.source_specs(2015)))
        self.assertTrue(any(s['name']=='savant_bat_tracking' for s in prepare.source_specs(2024)))

    def test_url_key_normalizes_order_not_season(self):
        a=prepare.request_key('https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&selections=a,b&sort=4')
        b=prepare.request_key('https://baseballsavant.mlb.com/leaderboard/custom',{'type':'batter','year':2025,'selections':'b,a','csv':'true'})
        self.assertEqual(a,b)
        self.assertNotEqual(a,prepare.request_key('https://baseballsavant.mlb.com/leaderboard/custom?year=2024&type=batter&selections=a,b'))

if __name__=='__main__':unittest.main()


class FanGraphsSnapshotTests(unittest.TestCase):
    def test_online_success_saved_then_offline_reused_with_timestamp(self):
        import json
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            directory=Path(folder)
            published=pd.DataFrame({'player_id':[668939], 'fwar':[1.0], 'wrc_plus':[104],
                                    'fwar__source':['fangraphs_pybaseball'], 'wrc_plus__source':['fangraphs_pybaseball']})
            with patch.object(sources,'SOURCE_DIR',directory), patch.object(sources,'fetch_pybaseball_stats',return_value=published):
                result=sources.fetch_fangraphs_with_fallback(2025,False,Mock())
            path=directory/'fangraphs_batting_2025.csv'
            original=path.read_bytes()
            metadata=path.with_suffix('.meta.json').read_bytes()
            self.assertIn('downloaded_at',json.loads(metadata))
            self.assertEqual(result.iloc[0].wrc_plus,104)
            self.assertNotIn('__source',original.decode())
            with patch.object(sources,'SOURCE_DIR',directory), patch.object(sources,'fetch_pybaseball_stats',return_value=pd.DataFrame()):
                result=sources.fetch_fangraphs_with_fallback(2025,False,Mock(side_effect=requests.ConnectionError('offline test')))
            self.assertEqual(result.iloc[0].fwar,1.0)
            self.assertTrue(result.iloc[0]['fwar__source'].startswith('local_csv:'))
            self.assertEqual(path.read_bytes(),original)
            self.assertEqual(path.with_suffix('.meta.json').read_bytes(),metadata)

    def test_admin_downloads_fangraphs_and_preserves_file_on_failure(self):
        spec=next(s for s in prepare.source_specs(2025) if s['name']=='fangraphs_pitching')
        frame=pd.DataFrame({'player_id':[1], 'fwar':[0.0], 'fip':[3.4]})
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, patch.object(prepare,'SOURCE_DIR',Path(folder)):
            with patch.object(sources,'fetch_fangraphs_with_fallback',return_value=frame) as fetch:
                self.assertEqual(prepare.download_one(spec)['status'],'downloaded')
                self.assertFalse(fetch.call_args.kwargs['local_fallback'])
            data=(Path(folder)/spec['filename']).read_bytes()
            with patch.object(sources,'fetch_fangraphs_with_fallback',return_value=pd.DataFrame()):
                self.assertEqual(prepare.download_one(spec,True)['status'],'failed')
            self.assertEqual((Path(folder)/spec['filename']).read_bytes(),data)
