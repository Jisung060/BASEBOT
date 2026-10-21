"""Local-first selection without provider requests or production snapshots."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts import collector_stat_sources as sources
from scripts import collector_savant_value_repair as repair
from scripts import prepare_source_csvs as prepare
from services import player_chart_data as charts


class LocalPriorityTests(unittest.TestCase):
    def test_complete_fangraphs_skips_online(self):
        frame = pd.DataFrame({'player_id':[1], 'fwar':[0], 'wrc_plus':[100]})
        with patch.object(sources, 'read_local_stats', return_value=frame), patch.object(sources, 'fetch_pybaseball_stats') as online:
            result = sources.fetch_fangraphs_with_fallback(2024, False, lambda: self.fail('HTTP'), expected_ids={1})
        online.assert_not_called()
        self.assertEqual(result.iloc[0].fwar, 0)

    def test_missing_player_requests_online_but_preserves_local(self):
        local = pd.DataFrame({'player_id':[1], 'fwar':[4], 'wrc_plus':[120]})
        remote = pd.DataFrame({'player_id':[1,2], 'fwar':[5,3], 'wrc_plus':[121,110]})
        with patch.object(sources, 'read_local_stats', return_value=local), patch.object(sources, 'fetch_pybaseball_stats', return_value=remote) as online:
            result = sources.fetch_fangraphs_with_fallback(2024, False, lambda: self.fail('HTTP'), save_snapshot=False, expected_ids={1,2}).set_index('player_id')
        online.assert_called_once()
        self.assertEqual(result.loc[1,'fwar'], 4)
        self.assertEqual(result.loc[2,'fwar'], 3)

    def test_complete_bref_skips_online(self):
        frame = pd.DataFrame({'player_id':[1], 'bwar':[0]})
        with patch.object(sources, 'read_local_stats', return_value=frame), patch.object(sources, 'fetch_pybaseball_stats') as online:
            self.assertEqual(sources.fetch_bref_war(2024, False, {}, expected_ids={1}).iloc[0].bwar, 0)
        online.assert_not_called()

    def test_savant_local_response_skips_http(self):
        frame = pd.DataFrame({'player_id':[1], 'xba':[.25]})
        frame.attrs['source'] = 'local_csv:test'
        with patch.object(prepare, 'read_prepared_for_request', return_value=frame), patch.object(sources.requests, 'get') as online:
            result = sources.request_csv('https://example.test/csv')
        online.assert_not_called()
        self.assertEqual(result.stat_source, 'local_csv:test')

    def test_mlb_local_first_and_explicit_download_bypass(self):
        frame = pd.DataFrame({'player_id':[1], 'homeRuns':[10]})
        with patch.object(prepare, 'read_prepared', return_value=frame) as local, patch.object(sources.requests, 'get') as online:
            result = sources.fetch_mlb_season_payload(2024, False)
            self.assertEqual(result['stats'][0]['splits'][0]['stat']['homeRuns'], 10)
            online.assert_not_called()
            local.reset_mock()
            online.return_value.json.return_value = {'stats':[{'splits':[{'season':'2024', 'player':{'id':1}, 'stat':{'homeRuns':11}}]}]}
            sources.fetch_mlb_season_payload(2024, False, local_fallback=False, save_snapshot=False)
            local.assert_not_called()
            online.assert_called_once()

    def test_extension_uses_validated_pitch_csv_without_inventing_percentile(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary:
            root = Path(temporary)
            spec = charts.chart_spec(2024, 1, 'pitching')
            frame = pd.DataFrame({'player_id':[1]*4, 'game_date':['2024-05-01']*4,
                                  'game_pk':[10]*4, 'at_bat_number':[1]*4,
                                  'pitch_number':[1,2,3,4], 'events':['','','','out'],
                                  'release_extension':[6,7,None,-1]})
            folder = root/'2024'/'1'
            prepare.write_snapshot(frame.to_csv(index=False).encode(), spec, directory=folder)
            with patch.object(charts, 'CHART_DIR', root), patch.object(repair, 'SOURCE_DIR', root), patch.object(repair.requests, 'get') as online:
                result = repair.fetch_pitcher_extension(1, 2024)
                self.assertEqual(result['pitch_extension'], 6.5)
                self.assertNotIn('extension_percentile', result)
                self.assertEqual(repair.local_pitcher_extension(1, 2023), {})
                (folder/'pitching.csv').write_text('corrupted', encoding='utf-8')
                self.assertEqual(repair.local_pitcher_extension(1, 2024), {})
            online.assert_not_called()


if __name__ == '__main__':
    unittest.main()
