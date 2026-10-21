"""Admin chart dispatch and read-only chart API wiring with an isolated database."""
import ast
from datetime import datetime, date
from pathlib import Path
import threading
import sys
from typing import Optional
import unittest
from unittest.mock import Mock
from fastapi import HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import create_engine, text

BACK=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(BACK))
NAMES={'ManualFetchRequest','_run_prepare_player_charts','get_chart_players','trigger_manual_fetch','_run_prepare_season_charts'}
TREE=ast.Module(body=[n for n in ast.parse((BACK/'routers/admin_baseball_data.py').read_text(encoding='utf-8')).body if getattr(n,'name',None) in NAMES],type_ignores=[])
for n in TREE.body:
    if hasattr(n,'decorator_list'):n.decorator_list=[]

class ChartAdminTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine('sqlite://');self.addCleanup(self.engine.dispose)
        with self.engine.begin() as conn:
            conn.execute(text('CREATE TABLE players (player_id INT, player_name TEXT)'))
            conn.execute(text('CREATE TABLE player_season_stats (player_id INT, season INT, is_pitcher BOOL, games INT)'))
            conn.execute(text("INSERT INTO players VALUES (1,'Test'),(2,'Other')"))
            conn.execute(text('INSERT INTO player_season_stats VALUES (1,2025,0,10),(1,2025,1,10),(2,2024,0,10)'))
        self.env=dict(BaseModel=BaseModel,Optional=Optional,Query=Query,datetime=datetime,engine=self.engine,text=text,
                      HTTPException=HTTPException,BackgroundTasks=object,baseball_sync_lock=threading.Lock(),
                      _create_sync_log=Mock(return_value=8),_execute_pipeline_job=Mock(),load_script_module=Mock())
        exec(compile(TREE,'admin_chart_test','exec'),self.env)

    def test_season_player_selection_and_dispatch(self):
        result=self.env['get_chart_players'](2025)
        self.assertEqual({r['mode'] for r in result['players']},{'batting','pitching'})
        self.assertEqual({r['player_id'] for r in result['players']},{1})
        req=self.env['ManualFetchRequest'](data_type='PREPARE_PLAYER_CHARTS',season=2025,player_id=1,chart_mode='pitching')
        background=Mock()
        self.assertEqual(self.env['trigger_manual_fetch'](req,background)['log_id'],8)
        background.add_task.assert_called_once()
        module=Mock();self.env['load_script_module'].return_value=(module,None)
        self.env['_run_prepare_player_charts'](2025,1,'pitching')
        module.collect_player_charts.assert_called_once_with(2025,1,'pitching')

    def test_batch_uses_only_selected_season_db_targets(self):
        module=Mock();self.env['load_script_module'].return_value=(module,None)
        self.env['_run_prepare_season_charts'](2024,False)
        args=module.collect_season_charts.call_args
        self.assertEqual(args.args[0],2024)
        self.assertEqual(args.args[1],[{'player_id':2,'name':'Other','mode':'batting'}])
        self.assertFalse(args.kwargs['refresh'])
        request=self.env['ManualFetchRequest'](data_type='PREPARE_PLAYER_CHARTS',season=2024,chart_all_players=True)
        self.assertEqual(self.env['trigger_manual_fetch'](request,Mock())['log_id'],8)
        request.season=2023
        with self.assertRaises(HTTPException):self.env['trigger_manual_fetch'](request,Mock())

    def test_invalid_player_or_season_does_not_start_job(self):
        for kwargs in ({},{'player_id':1,'season':2014},{'player_id':2,'season':2025},{'player_id':1,'chart_mode':'wrong'}):
            args=dict(data_type='PREPARE_PLAYER_CHARTS',season=2025);args.update(kwargs)
            with self.assertRaises(HTTPException):
                self.env['trigger_manual_fetch'](self.env['ManualFetchRequest'](**args),Mock())
        self.env['_create_sync_log'].assert_not_called()

    def test_public_api_only_reads_local_data(self):
        tree=ast.Module(body=[n for n in ast.parse((BACK/'routers/players.py').read_text(encoding='utf-8')).body if getattr(n,'name',None)=='get_player_charts'],type_ignores=[])
        tree.body[0].decorator_list=[]
        env=dict(Query=Query,date=date,HTTPException=HTTPException)
        exec(compile(tree,'chart_endpoint','exec'),env)
        from unittest.mock import patch
        from services import player_chart_data
        with patch.object(player_chart_data,'load_player_charts',return_value={'charts':{}}) as read:
            self.assertEqual(env['get_player_charts'](1,2025,'batting'),{'charts':{}})
            read.assert_called_once_with(2025,1,'batting')

if __name__=='__main__':unittest.main()
