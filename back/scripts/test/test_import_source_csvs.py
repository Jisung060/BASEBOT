"""Offline import mapping and real SQL update behavior using an in-memory database."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import pandas as pd
from sqlalchemy import create_engine, text, event

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts import import_source_csvs as loader
from scripts import prepare_source_csvs as prepare


class ImportCSVTests(unittest.TestCase):
    def test_raw_values_and_official_percentiles_are_separate(self):
        spec=next(s for s in prepare.source_specs(2025) if s['name']=='savant_batter_statcast')
        raw=pd.DataFrame({'player_id':[1], 'xba':[.241], 'exit_velocity_avg':[89.4]})
        mapped=loader.map_snapshot(raw,spec,False)
        self.assertEqual(mapped.iloc[0].xba,.241)
        self.assertNotIn('xba_percentile',mapped)
        pct={**spec,'name':'savant_percentiles_batter'}
        mapped=loader.map_snapshot(pd.DataFrame({'player_id':[1],'xba':[0]}),pct,False)
        self.assertEqual(mapped.iloc[0].xba_percentile,0)
        self.assertNotIn('xba',mapped)

    def test_replaces_unknown_but_preserves_verified_original_missing_rows_and_other_role(self):
        engine=create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE player_season_stats (player_id INT, season INT, is_pitcher BOOL, fwar FLOAT, wrc_plus FLOAT)'))
            conn.execute(text('CREATE TABLE player_stat_provenance (player_id INT, season INT, is_pitcher BOOL, metric TEXT, source TEXT, stored_value FLOAT)'))
            conn.execute(text('INSERT INTO player_season_stats VALUES (1,2025,0,NULL,90),(2,2025,0,2,100),(3,2025,0,3,110),(4,2025,0,4,120),(1,2025,1,5,130),(1,2024,0,6,140)'))
            conn.execute(text("INSERT INTO player_stat_provenance VALUES (2,2025,0,'fwar','estimated',2),(3,2025,0,'fwar','fangraphs_http',3),(4,2025,0,'fwar','estimated',99)"))
        frame=pd.DataFrame({'player_id':[1,2,3,4,999], 'fwar':[0,4,9,9,10], 'wrc_plus':[None]*5,
                            'fwar__source':['local_csv:test.csv']*5, 'wrc_plus__source':['local_csv:test.csv']*5})
        recorded=[]
        with patch.object(loader,'ensure_provenance_table'), patch.object(loader,'save_provenance',side_effect=lambda conn,records:recorded.extend(records)):
            summary=loader.apply_frames(engine,{False:frame},2025)
        self.assertEqual(summary,{'updated_rows':3,'updated_values':3,'updated_sources':3})
        self.assertEqual(len(recorded),3)
        with engine.connect() as conn:
            rows=conn.execute(text('SELECT player_id,season,is_pitcher,fwar,wrc_plus FROM player_season_stats ORDER BY season, is_pitcher, player_id')).all()
        self.assertEqual([tuple(r) for r in rows],[(1,2024,0,6.,140.),(1,2025,0,0.,90.),(2,2025,0,4.,100.),(3,2025,0,3.,110.),(4,2025,0,9.,120.),(1,2025,1,5.,130.)])

    def test_equal_original_updates_only_source_and_repeat_is_noop(self):
        engine=create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE player_season_stats (player_id INT, season INT, is_pitcher BOOL, fwar FLOAT)'))
            conn.execute(text('CREATE TABLE player_stat_provenance (player_id INT,season INT,is_pitcher BOOL,metric TEXT,source TEXT,stored_value FLOAT,PRIMARY KEY(player_id,season,is_pitcher,metric))'))
            conn.execute(text('INSERT INTO player_season_stats VALUES (1,2025,0,0)'))
            conn.execute(text("INSERT INTO player_stat_provenance VALUES (1,2025,0,'fwar','legacy_unknown',0)"))
        statements=[]
        event.listen(engine,'before_cursor_execute',lambda conn,cursor,statement,params,context,many:statements.append(statement))
        frame=pd.DataFrame({'player_id':[1],'fwar':[0],'fwar__source':['local_csv:fangraphs_batting_2025.csv']})
        def save(conn,records):
            if records:
                conn.execute(text('INSERT OR REPLACE INTO player_stat_provenance (player_id,season,is_pitcher,metric,source,stored_value) VALUES (:player_id,:season,:is_pitcher,:metric,:source,:value)'),records)
        with patch.object(loader,'ensure_provenance_table'),patch.object(loader,'save_provenance',side_effect=save):
            summary=loader.apply_frames(engine,{False:frame},2025)
            self.assertEqual(summary,{'updated_rows':1,'updated_values':0,'updated_sources':1})
            self.assertFalse(any(sql.startswith('UPDATE player_season_stats') for sql in statements))
            with engine.connect() as conn:
                self.assertEqual(conn.execute(text('SELECT source FROM player_stat_provenance')).scalar(),'local_csv:fangraphs_batting_2025.csv')
            statements.clear()
            self.assertEqual(loader.apply_frames(engine,{False:frame},2025),{'updated_rows':0,'updated_values':0,'updated_sources':0})
            self.assertFalse(any(sql.startswith(('UPDATE','INSERT')) for sql in statements))

    def test_calculated_input_never_relabels_or_replaces_unknown(self):
        engine=create_engine('sqlite://')
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text('CREATE TABLE player_season_stats (player_id INT, season INT, is_pitcher BOOL, fwar FLOAT)'))
            conn.execute(text('CREATE TABLE player_stat_provenance (player_id INT,season INT,is_pitcher BOOL,metric TEXT,source TEXT,stored_value FLOAT)'))
            conn.execute(text('INSERT INTO player_season_stats VALUES (1,2025,0,3)'))
        frame=pd.DataFrame({'player_id':[1],'fwar':[9],'fwar__source':['estimated']})
        with patch.object(loader,'ensure_provenance_table'),patch.object(loader,'save_provenance') as save:
            self.assertEqual(loader.apply_frames(engine,{False:frame},2025)['updated_sources'],0)
            self.assertEqual(save.call_args.args[1],[])
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text('SELECT fwar FROM player_season_stats')).scalar(),3)

    def test_dry_run_never_opens_database(self):
        with patch.object(loader,'load_frames',return_value=({False:pd.DataFrame()},[{'status':'ready'}])), patch.object(loader,'apply_frames') as apply:
            summary=loader.import_source_csvs(2025)
        self.assertEqual(summary['mode'],'dry_run')
        apply.assert_not_called()

if __name__=='__main__':unittest.main()
