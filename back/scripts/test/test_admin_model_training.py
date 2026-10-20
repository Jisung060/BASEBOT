"""Admin model-training wiring tests; no database/model imports or training."""
import ast
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import traceback
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock, MagicMock
from pydantic import BaseModel

source = Path(__file__).resolve().parents[2] / 'routers/admin_baseball_data.py'
names = {'ManualFetchRequest', '_run_model_training', '_execute_pipeline_job', '_create_sync_log'}
tree = ast.parse(source.read_text(encoding='utf-8'))
selected = ast.Module(body=[n for n in tree.body if getattr(n, 'name', '') in names], type_ignores=[])

class ModelTrainingTests(unittest.TestCase):
    def setUp(self):
        self.run = Mock(return_value=SimpleNamespace(stdout='trained'))
        self.env = dict(BaseModel=BaseModel, Optional=Optional, BACK_DIR=source.parents[1],
                        sys=SimpleNamespace(executable=sys.executable, modules={}), os=os,
                        subprocess=SimpleNamespace(run=self.run, PIPE=subprocess.PIPE, STDOUT=subprocess.STDOUT,
                                                   CalledProcessError=subprocess.CalledProcessError),
                        engine=MagicMock(), text=lambda sql: sql, time=time, traceback=Mock(),
                        baseball_sync_lock=threading.Lock(), _update_log_progress=Mock())
        exec(compile(selected, str(source), 'exec'), self.env)

    def test_fixed_scripts_use_server_python_and_reload_loaded_models(self):
        for dtype, filename, module_name, instance, method in [
            ('TRAIN_ML_MODEL','ml/train_prediction_model.py','services.prediction_service','predictor','_load_model'),
            ('TRAIN_DL_MODEL','services/player_dl_predictor.py','services.player_dl_predictor','dl_predictor','_ensure_loaded')]:
            with self.subTest(dtype=dtype):
                predictor = Mock()
                self.env['sys'].modules[module_name] = SimpleNamespace(**{instance: predictor})
                self.assertEqual(self.env['_run_model_training'](dtype), 'trained')
                args, kwargs = self.run.call_args
                self.assertEqual(args[0], [sys.executable, '-u', str(source.parents[1] / filename)])
                self.assertTrue(kwargs['check'])
                self.assertEqual(kwargs['cwd'], str(source.parents[1]))
                getattr(predictor, method).assert_called_once()

    def test_subprocess_failure_is_reported(self):
        self.run.side_effect = subprocess.CalledProcessError(1, 'python', output='training error')
        with self.assertRaisesRegex(RuntimeError, 'training error'):
            self.env['_run_model_training']('TRAIN_ML_MODEL')

    def test_dispatch_logs_success_or_failure_and_releases_lock(self):
        for dtype in ('TRAIN_ML_MODEL', 'TRAIN_DL_MODEL'):
            for fail in (False, True):
                with self.subTest(dtype=dtype, fail=fail):
                    self.env['_run_model_training'] = Mock(side_effect=RuntimeError('failed') if fail else None, return_value='trained')
                    req = self.env['ManualFetchRequest'](data_type=dtype)
                    self.env['_execute_pipeline_job'](1, req)
                    self.env['_run_model_training'].assert_called_once_with(dtype)
                    params = self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
                    self.assertEqual(params['status'], 'FAILED' if fail else 'SUCCESS')
                    self.assertFalse(self.env['baseball_sync_lock'].locked())

    def test_training_log_targets_whole_database(self):
        for dtype in ('TRAIN_ML_MODEL', 'TRAIN_DL_MODEL'):
            self.env['_create_sync_log'](self.env['ManualFetchRequest'](data_type=dtype))
            params = self.env['engine'].begin.return_value.__enter__.return_value.execute.call_args.args[1]
            self.assertEqual(params['tparam'], '전체 DB 대상')

    def test_dl_cli_does_not_initialize_service_before_training(self):
        dl = source.parents[1] / 'services/player_dl_predictor.py'
        assignment = next(n for n in ast.parse(dl.read_text(encoding='utf-8')).body
                          if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'dl_predictor' for t in n.targets))
        predictor = Mock()
        namespace = {'__name__': '__main__', 'PlayerDLPredictor': predictor}
        exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(dl), 'exec'), namespace)
        predictor.assert_not_called()

if __name__ == '__main__':
    unittest.main()
