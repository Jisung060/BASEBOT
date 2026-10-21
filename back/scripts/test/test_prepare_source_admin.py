"""CSV preparation dispatch without importing DB-initializing admin modules."""
import ast
from pathlib import Path
import threading
import time
from typing import Optional
import unittest
from unittest.mock import Mock, MagicMock
from pydantic import BaseModel

FILE=Path(__file__).resolve().parents[2]/'routers/admin_baseball_data.py'
NAMES={'ManualFetchRequest','_run_prepare_source_csvs','_run_import_source_csvs','_execute_pipeline_job'}
TREE=ast.Module(body=[n for n in ast.parse(FILE.read_text(encoding='utf-8')).body if getattr(n,'name',None) in NAMES],type_ignores=[])
class PrepareAdminTests(unittest.TestCase):
    def setUp(self):
        self.env=dict(BaseModel=BaseModel,Optional=Optional,baseball_sync_lock=threading.Lock(),
                      engine=MagicMock(),time=time,traceback=Mock(),text=lambda s:s,
                      load_script_module=Mock(),_update_log_progress=Mock())
        exec(compile(TREE,str(FILE),'exec'),self.env)
    def test_passes_selected_season_and_force_flag(self):
        module=Mock();self.env['load_script_module'].return_value=(module,None)
        self.env['_run_prepare_source_csvs'](2015,True)
        module.prepare_source_csvs.assert_called_once_with(season=2015,force=True)
    def test_offline_import_dispatch_and_counts(self):
        self.env['_run_import_source_csvs']=Mock(return_value=dict(updated_rows=3,updated_values=7,ready_files=12,unavailable_files=4))
        req=self.env['ManualFetchRequest'](data_type='IMPORT_SOURCE_CSVS',season=2025)
        self.env['_execute_pipeline_job'](1,req)
        self.env['_run_import_source_csvs'].assert_called_once_with(2025)
        params=self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
        self.assertEqual(params['rcnt'],3)
        self.assertEqual(params['status'],'PARTIAL')
        self.assertFalse(self.env['baseball_sync_lock'].locked())

    def test_chart_job_uses_existing_worker_and_reports_pitch_count(self):
        self.env['_run_prepare_player_charts']=Mock(return_value={'rows':100})
        req=self.env['ManualFetchRequest'](data_type='PREPARE_PLAYER_CHARTS',season=2025,player_id=592450,chart_mode='batting')
        self.env['_execute_pipeline_job'](1,req)
        self.env['_run_prepare_player_charts'].assert_called_once_with(2025,592450,'batting')
        params=self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
        self.assertEqual(params['status'],'SUCCESS')
        self.assertEqual(params['rcnt'],100)
        self.assertIn('DB 적재 없음',params['msg'])

    def test_chart_batch_job_records_partial_failure(self):
        self.env['_run_prepare_season_charts']=Mock(return_value={'total':3,'downloaded':1,'cached':1,'failed':1,'results':[{'player_id':3,'mode':'batting','status':'failed','error':'offline'}]})
        req=self.env['ManualFetchRequest'](data_type='PREPARE_PLAYER_CHARTS',season=2024,chart_all_players=True)
        self.env['_execute_pipeline_job'](1,req)
        self.assertEqual(self.env['_run_prepare_season_charts'].call_args.args[:2],(2024,False))
        params=self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
        self.assertEqual(params['status'],'PARTIAL');self.assertEqual(params['rcnt'],2)
        self.assertIn('2024',params['msg']);self.assertIn('3 batting',params['msg'])

    def test_log_states_match_partial_failure(self):
        for downloaded,failed,expected in [(12,0,'SUCCESS'),(12,2,'PARTIAL'),(0,2,'FAILED')]:
            results=[dict(source='bref',status='failed',error='403')] if failed else []
            self.env['_run_prepare_source_csvs']=Mock(return_value=dict(downloaded=downloaded,cached=0,failed=failed,results=results))
            req=self.env['ManualFetchRequest'](data_type='PREPARE_SOURCE_CSVS',season=2025,force_csv_download=True)
            self.env['_execute_pipeline_job'](1,req)
            self.env['_run_prepare_source_csvs'].assert_called_once_with(2025,True)
            params=self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
            self.assertEqual(params['status'],expected)
            self.assertEqual(params['rcnt'],downloaded)
            self.assertIn('DB 적재 없음',params['msg'])
            self.assertFalse(self.env['baseball_sync_lock'].locked())
if __name__=='__main__':unittest.main()
