"""Season batch collection is bounded, resumable and never crosses season directories."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from scripts import prepare_player_charts as batch
from services import player_chart_data as data
from scripts.prepare_source_csvs import write_snapshot

class ChartBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        patcher=patch.object(data,'CHART_DIR',self.root);patcher.start();self.addCleanup(patcher.stop)

    def snapshot(self,season,pid,mode):
        frame=pd.DataFrame({'player_id':[pid],'game_date':[f'{season}-04-01'],'game_pk':[1],'at_bat_number':[1],'pitch_number':[1],'events':['single']})
        spec=data.chart_spec(season,pid,mode)
        write_snapshot(frame.to_csv(index=False).encode(),spec,directory=self.root/str(season)/str(pid))

    def test_batch_same_season_cache_dedup_partial_failure_and_report(self):
        self.snapshot(2024,1,'batting');self.snapshot(2025,2,'pitching')
        calls=[];progress=[]
        def collect(season,pid,mode):
            calls.append((season,pid,mode))
            if pid==3:raise ValueError('provider failure')
            self.snapshot(season,pid,mode)
            return {'rows':1,'season':season,'player_id':pid,'mode':mode}
        targets=[{'player_id':1,'mode':'batting'},{'player_id':1,'mode':'batting'},{'player_id':2,'mode':'pitching'},{'player_id':3,'mode':'batting'}]
        old=(self.root/'2025/2/pitching.csv').read_bytes()
        with patch.object(batch,'collect_player_charts',side_effect=collect):
            summary=batch.collect_season_charts(2024,targets,progress=lambda done,total,s:progress.append((done,total)))
        self.assertEqual(summary['total'],3)
        self.assertEqual((summary['downloaded'],summary['cached'],summary['failed']),(1,1,1))
        self.assertEqual(set(calls),{(2024,2,'pitching'),(2024,3,'batting')})
        self.assertEqual(progress[-1],(3,3))
        self.assertEqual((self.root/'2025/2/pitching.csv').read_bytes(),old)
        report=json.loads((self.root/'2024/batch_summary.json').read_text())
        self.assertEqual(report['season'],2024);self.assertEqual(report['failed'],1)

    def test_refresh_failure_keeps_existing_snapshot(self):
        self.snapshot(2024,1,'batting');path=self.root/'2024/1/batting.csv';old=path.read_bytes()
        with patch.object(batch,'collect_player_charts',side_effect=ValueError('offline')):
            summary=batch.collect_season_charts(2024,[{'player_id':1,'mode':'batting'}],refresh=True)
        self.assertEqual(summary['failed'],1);self.assertEqual(path.read_bytes(),old)

    def test_bad_or_empty_targets_fail_before_network(self):
        for targets in ([],[{'player_id':-1,'mode':'batting'}]):
            with patch.object(batch,'collect_player_charts') as collect:
                with self.assertRaises(ValueError):batch.collect_season_charts(2024,targets)
                collect.assert_not_called()

if __name__=='__main__':unittest.main()
