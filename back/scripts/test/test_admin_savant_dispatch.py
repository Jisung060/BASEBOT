"""Exercise admin dispatch without importing its database-initializing module."""
import ast
from pathlib import Path
import subprocess
import sys
import time
import traceback
from typing import Optional
import unittest
from unittest.mock import Mock, MagicMock
from pydantic import BaseModel

source = Path(__file__).resolve().parents[2] / 'routers' / 'admin_baseball_data.py'
names = {'ManualFetchRequest', '_run_savant_repair', '_execute_pipeline_job', '_run_savant_extension', 'init_admin_baseball_tables'}
tree = ast.parse(source.read_text(encoding='utf-8'))
selected = ast.Module(body=[node for node in tree.body if getattr(node, 'name', None) in names], type_ignores=[])

class AdminSavantDispatchTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(BaseModel=BaseModel, Optional=Optional, time=time,
                        traceback=traceback, sys=sys, subprocess=Mock(),
                        BACK_DIR=source.parents[1], text=lambda sql: sql,
                        engine=MagicMock(), load_script_module=Mock(), find_script_path=Mock())
        exec(compile(selected, str(source), 'exec'), self.env)
        self.env['engine'].connect.return_value.__enter__.return_value.execute.return_value.scalar.return_value = 12

    def test_direct_default_and_refresh_forward_selected_season(self):
        module = Mock()
        self.env['load_script_module'].return_value = (module, None)
        run = self.env['_run_savant_repair']
        self.assertEqual(run(2025), 12)
        module.run_savant_repair.assert_called_with(season=2025, refresh_pitcher_details=False)
        run(2024, True)
        module.run_savant_repair.assert_called_with(season=2024, refresh_pitcher_details=True)
        self.assertFalse(self.env['ManualFetchRequest'](data_type='STEP_SAVANT_REPAIR').refresh_pitcher_details)

    def test_pipeline_and_single_step_forward_mode_and_log_it(self):
        for dtype in ('PIPELINE_PLAYERS', 'STEP_SAVANT_REPAIR'):
            for refresh in (False, True):
                with self.subTest(dtype=dtype, refresh=refresh):
                    for name in ('_run_batters', '_run_pitchers', '_run_players_meta', '_run_savant_repair'):
                        self.env[name] = Mock(return_value=12)
                    self.env['_update_log_progress'] = Mock()
                    req = self.env['ManualFetchRequest'](data_type=dtype, season=2025, refresh_pitcher_details=refresh)
                    self.env['_execute_pipeline_job'](1, req)
                    self.env['_run_savant_repair'].assert_called_once_with(2025, refresh_pitcher_details=refresh)
                    conn = self.env['engine'].begin.return_value.__enter__.return_value
                    params = conn.execute.call_args.args[1]
                    self.assertEqual(params['status'], 'SUCCESS')
                    self.assertIn('투수 상세 갱신' if refresh else '빠른 갱신', params['msg'])

    def test_extension_dispatch_is_separate_and_forwards_season(self):
        module = Mock()
        self.env['load_script_module'].return_value = (module, None)
        self.env['_run_savant_extension'](2025)
        module.run_savant_repair.assert_called_once_with(season=2025, extension_only=True)
        self.env['_run_savant_extension'] = Mock(return_value=10)
        self.env['_run_savant_repair'] = Mock()
        self.env['_update_log_progress'] = Mock()
        req = self.env['ManualFetchRequest'](data_type='STEP_SAVANT_EXTENSION', season=2025)
        self.env['_execute_pipeline_job'](1, req)
        self.env['_run_savant_extension'].assert_called_once_with(2025)
        self.env['_run_savant_repair'].assert_not_called()

    def test_schedule_split_adds_disabled_extension_and_preserves_existing_settings(self):
        self.env['init_admin_baseball_tables']()
        conn = self.env['engine'].begin.return_value.__enter__.return_value
        inserts = [call.args[1] for call in conn.execute.call_args_list
                   if 'INSERT IGNORE INTO admin_data_schedules' in call.args[0]]
        indexed = {row['dtype']: row for row in inserts}
        self.assertIn('Extension 제외', indexed['STEP_SAVANT_REPAIR']['label'])
        self.assertFalse(indexed['STEP_SAVANT_EXTENSION']['enabled'])
        self.assertEqual(indexed['STEP_SAVANT_EXTENSION']['iv_type'], 'WEEKLY')
        updates = [call for call in conn.execute.call_args_list
                   if 'UPDATE admin_data_schedules' in call.args[0]]
        self.assertEqual(len(updates), 2)
        for call in updates:
            self.assertEqual(set(call.args[1]), {'label', 'dtype'})
            self.assertNotIn('is_enabled', call.args[0])
            self.assertNotIn('target_option', call.args[0])

    def test_subprocess_fallback_passes_flag_and_checks_failure(self):
        self.env['load_script_module'].return_value = (object(), None)
        self.env['find_script_path'].return_value = Path('collector_savant_value_repair.py')
        self.env['_run_savant_repair'](2025, True)
        call = self.env['subprocess'].run.call_args
        self.assertIn('--refresh-pitcher-details', call.args[0])
        self.assertEqual(call.kwargs['timeout'], 1800)
        self.assertTrue(call.kwargs['check'])

if __name__ == '__main__':
    unittest.main()
