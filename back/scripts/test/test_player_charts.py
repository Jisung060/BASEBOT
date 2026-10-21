"""Chart snapshots and derivations: no network or production database required."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import pandas as pd
import requests
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from services import player_chart_data as charts


class PlayerChartsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        patcher=patch.object(charts,'CHART_DIR',self.folder);patcher.start();self.addCleanup(patcher.stop)

    def raw(self):
        return pd.DataFrame({'batter':[1],'game_date':['2025-04-01'],'game_pk':[1],'at_bat_number':[1],'pitch_number':[1],
                             'events':['single'],'hc_x':[110],'hc_y':[100],'estimated_woba_using_speedangle':[.5],'woba_value':[.9],'woba_denom':[1]})

    def collect(self,frame):
        response=Mock();response.iter_content.return_value=[frame.to_csv(index=False).encode('utf-8')]
        with patch.object(charts.requests,'get',return_value=response):
            return charts.collect_player_charts(2025,1,'batting')

    def test_file_absent_is_empty_and_read_never_collects(self):
        with patch.object(charts.requests,'get') as get:
            self.assertEqual(charts.load_player_charts(2025,1,'batting')['charts'],{})
        get.assert_not_called()

    def test_roundtrip_and_failed_refresh_preserve_file_and_time(self):
        self.assertEqual(self.collect(self.raw())['rows'],1)
        result=charts.load_player_charts(2025,1,'batting')
        self.assertEqual(result['charts']['spray']['points'][0]['events'],'single')
        self.assertNotIn('rolling_xwoba',result['charts'])
        file=self.folder/'2025/1/batting.csv';old=file.read_bytes()
        meta=file.with_suffix('.meta.json').read_bytes()
        with patch.object(charts.requests,'get',side_effect=requests.ConnectionError('offline')):
            with self.assertRaises(requests.ConnectionError):charts.collect_player_charts(2025,1,'batting')
        self.assertEqual(file.read_bytes(),old);self.assertEqual(file.with_suffix('.meta.json').read_bytes(),meta)
        file.write_bytes(b'corrupt')
        self.assertEqual(charts.load_player_charts(2025,1,'batting')['charts'],{})

    def test_wrong_identity_year_and_duplicate_response_never_replace(self):
        self.collect(self.raw());file=self.folder/'2025/1/batting.csv';old=file.read_bytes()
        wrong=self.raw();wrong['batter']=2
        year=self.raw();year['game_date']='2024-04-01'
        duplicate=pd.concat([self.raw(),self.raw()])
        postseason=self.raw();postseason["game_type"]="F"
        for frame in (wrong,year,duplicate,postseason):
            with self.assertRaises(ValueError):self.collect(frame)
            self.assertEqual(file.read_bytes(),old)

    def test_rolling_requires_100_terminal_pa_and_keeps_missing_gaps(self):
        frame=pd.DataFrame({'game_date':['2025-04-01']*101,'game_pk':[1]*101,'at_bat_number':range(1,102),
                            'pitch_number':[1]*101,'events':['single']*101,'estimated_woba_using_speedangle':[.5]*101,
                            'woba_value':[.9]*101,'woba_denom':[1]*101})
        frame.loc[0,['events','estimated_woba_using_speedangle','woba_denom']]=['intent_walk',float('nan'),float('nan')]
        result=charts.chart_points(frame,'batting')['rolling_xwoba']['points']
        self.assertEqual([p['pa'] for p in result],[100,101]);self.assertEqual(result[0]['value'],.5)
        self.assertNotIn('rolling_xwoba',charts.chart_points(frame.iloc[:99],'batting'))
        frame.loc[50,'estimated_woba_using_speedangle']=float('nan')
        self.assertNotIn('rolling_xwoba',charts.chart_points(frame,'batting'))

    def test_movement_units_sample_and_bad_data_hidden(self):
        frame=pd.DataFrame({'game_date':['2025-04-01']*150,'game_pk':[1]*150,'at_bat_number':range(150),
                            'pitch_number':[1]*150,'pitch_type':['FF']*150,'pfx_x':[-1]*150,'pfx_z':[1.5]*150})
        result=charts.chart_points(frame,'pitching')['movement']
        self.assertEqual(result['total_pitches'],150);self.assertEqual(len(result['points']),100)
        self.assertEqual(result['points'][0],{'x':-12.,'y':18.,'pitch_type':'FF'})
        frame['pitch_type']=float('nan')
        self.assertEqual(charts.chart_points(frame,'pitching'),{})

    def test_no_other_season_fallback_and_metadata_must_match(self):
        self.collect(self.raw())
        self.assertEqual(charts.load_player_charts(2024,1,'batting')['charts'],{})
        self.assertEqual(charts.load_player_charts(2025,1,'batting')['season'],2025)
        import json
        meta=self.folder/'2025/1/batting.meta.json'
        payload=json.loads(meta.read_text(encoding='utf-8'));payload['season']=2024
        meta.write_text(json.dumps(payload),encoding='utf-8')
        self.assertEqual(charts.load_player_charts(2025,1,'batting')['charts'],{})

    def test_invalid_path_inputs(self):
        for args in [(2014,1,'batting'),(2025,-1,'batting'),(2025,1,'../../')]:
            with self.assertRaises(ValueError):charts.chart_spec(*args)

if __name__=='__main__':unittest.main()
