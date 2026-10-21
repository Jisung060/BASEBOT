import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path
import pandas as pd

spec = importlib.util.spec_from_file_location('repair', Path(__file__).resolve().parents[1] / 'collector_savant_value_repair.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

class SavantRepairTests(unittest.TestCase):
    def test_fielding_csv_columns_and_season(self):
        frame = pd.DataFrame({'id': [592450], 'total_runs': [4.678], 'arm_runs': [2.267]})
        with patch.object(repair, 'safe_csv_get', return_value=frame) as fetch:
            result = repair.fetch_fielding_and_arm_value(2025).iloc[0]
        self.assertEqual(result['fielding_run_value'], 5)
        self.assertEqual(result['arm_value'], 2)
        self.assertEqual(fetch.call_args.args[1]['seasonStart'], 2025)
        self.assertEqual(fetch.call_args.args[1]['seasonEnd'], 2025)

    def test_bat_tracking_season_and_percentage(self):
        frame = pd.DataFrame({'id': [592450], 'avg_bat_speed': [76.9405], 'squared_up_per_swing': [0.231898]})
        with patch.object(repair, 'safe_csv_get', return_value=frame) as fetch:
            result = repair.fetch_bat_tracking(2025).iloc[0]
        self.assertEqual(result['bat_speed'], 76.9)
        self.assertEqual(result['squared_up_percentage'], 23.2)
        self.assertEqual(fetch.call_args.args[1]['seasonStart'], 2025)
        self.assertEqual(fetch.call_args.args[1]['seasonEnd'], 2025)

class PitcherRepairTests(unittest.TestCase):
    def test_run_values_use_supported_columns_without_sign_inversion(self):
        frame = pd.DataFrame({"player_id": [607074, 1],
                              "pitch_run_value_fastball": [-4.82075, 10.0],
                              "pitch_run_value_breaking": [-7.71161, None],
                              "pitch_run_value_offspeed": [6.00339, None]})
        with patch.object(repair, "safe_csv_get", return_value=frame) as fetch:
            result = repair.fetch_pitch_run_values(2024).set_index("player_id")
        self.assertEqual(result.loc[607074, "fastball_run_value"], -5)
        self.assertEqual(result.loc[607074, "breaking_run_value"], -8)
        self.assertEqual(result.loc[607074, "offspeed_run_value"], 6)
        self.assertTrue(pd.isna(result.loc[1, "offspeed_run_value"]))
        self.assertLess(result.loc[607074, "fastball_run_value_percentile"],
                        result.loc[1, "fastball_run_value_percentile"])
        self.assertEqual(fetch.call_args.args[0], "/leaderboard/custom")
        self.assertEqual(fetch.call_args.args[1]["year"], 2024)

    def test_extension_uses_requested_pitching_season(self):
        rows = [{"year": 2025, "player_type": "pitcher", "fastball_extension": "9"},
                {"year": 2024, "player_type": "batter", "fastball_extension": "8"},
                {"year": 2024, "player_type": "pitcher", "aggregate": "0",
                 "fastball_extension": "6.1", "percent_rank_fastball_extension": 21,
                 "percent_rank_pitch_run_value_fastball": 0}]
        response = unittest.mock.Mock()
        response.text = "statcast: " + repair.json.dumps(rows) + ", other: []"
        with patch.object(repair.requests, "get", return_value=response):
            result = repair.fetch_pitcher_extension(607074, 2024)
        self.assertEqual(result, {"player_id": 607074, "pitch_extension": 6.1,
                                  "extension_percentile": 21, "extension_percentile__source": "savant_player", "fastball_run_value_percentile": 0})

    def test_extension_supplements_only_existing_pitchers(self):
        frame = pd.DataFrame({"player_id": [607074, 1], "release_extension": [None, None]})
        supplement = {"player_id": 607074, "pitch_extension": 6.1, "extension_percentile": 21}
        with patch.object(repair, "safe_csv_get", return_value=frame), patch.object(
                repair, "fetch_pitcher_extension", return_value=supplement) as fetch:
            result = repair.fetch_pitcher_extra(2024, {607074}, refresh_pitcher_details=True)
        fetch.assert_called_once_with(607074, 2024)
        self.assertEqual(result["player_id"].tolist(), [607074])
        self.assertEqual(result.iloc[0]["pitch_extension"], 6.1)
        self.assertEqual(result.iloc[0]["extension_percentile"], 21)

class FastPitcherCollectionTests(unittest.TestCase):
    def test_default_avoids_player_requests_and_preserves_saved_details(self):
        frame = pd.DataFrame({"player_id": [607074, 1], "release_extension": [None, None]})
        cache = pd.DataFrame({"player_id": [607074, 1], "pitch_extension": [6.1, None],
                              "extension_percentile": [21, None],
                              "fastball_run_value_percentile": [0, None]})
        with patch.object(repair, "safe_csv_get", return_value=frame), patch.object(
                repair, "fetch_pitcher_extension") as fetch:
            result = repair.fetch_pitcher_extra(2024, {607074, 1}, cache).set_index("player_id")
        fetch.assert_not_called()
        self.assertEqual(result.loc[607074, "pitch_extension"], 6.1)
        self.assertEqual(result.loc[607074, "extension_percentile"], 21)
        self.assertEqual(result.loc[607074, "fastball_run_value_percentile"], 0)
        self.assertTrue(pd.isna(result.loc[1, "pitch_extension"]))

    def test_fast_merge_keeps_bulk_run_values_and_saved_official_percentiles(self):
        bulk = pd.DataFrame({"player_id": [607074], "fastball_run_value": [-5],
                             "fastball_run_value_percentile": [18]})
        saved = pd.DataFrame({"player_id": [607074], "fastball_run_value_percentile": [10],
                              "pitch_extension": [6.1]})
        result = repair.merge_frames([bulk, saved]).iloc[0]
        self.assertEqual(result["fastball_run_value"], -5)
        self.assertEqual(result["fastball_run_value_percentile"], 10)
        self.assertEqual(result["pitch_extension"], 6.1)

class ExtensionOnlyTests(unittest.TestCase):
    def test_only_extension_columns_are_written_without_csv_requests(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        engine = MagicMock()
        columns = unittest.mock.Mock()
        columns.scalars.return_value.all.return_value = ["pitch_extension", "extension_percentile"]
        players = unittest.mock.Mock()
        players.mappings.return_value.all.return_value = [{"player_id": 607074, "pitch_extension": 6.1, "extension_percentile": 21}]
        engine.connect.return_value.__enter__.return_value.execute.side_effect = [columns, players]
        details = {"player_id": 607074, "pitch_extension": 6.2, "extension_percentile": 25,
                   "fastball_run_value_percentile": 40}
        with patch.dict(repair.sys.modules, {"database.db_connection": SimpleNamespace(engine=engine)}), patch.object(
                repair, "fetch_pitcher_extension", return_value=details), patch.object(
                repair, "safe_csv_get") as csv, patch.object(repair, "bulk_update_role") as update:
            repair.run_savant_repair(2024, extension_only=True)
        csv.assert_not_called()
        update.assert_called_once()
        self.assertEqual(update.call_args.args[1].columns.tolist(),
                         ["player_id", "pitch_extension", "extension_percentile"])
        self.assertEqual(update.call_args.args[2:4], (2024, True))

class FramingCollectionTests(unittest.TestCase):
    def test_framing_uses_season_fielding_csv_and_ranks_unrounded_values(self):
        frame = pd.DataFrame({"id": [668939, 2, 3, 4],
                              "total_runs": [2.0, 0, 1, 0],
                              "framing_runs": [2.448, 2.1, 0.0, None]})
        with patch.object(repair, "safe_csv_get", return_value=frame) as fetch:
            result = repair.fetch_fielding_and_arm_value(2025).set_index("player_id")
        self.assertEqual(result.loc[668939, "framing_runs"], 2)
        self.assertEqual(result.loc[668939, "framing_runs_percentile"], 100)
        self.assertEqual(result.loc[3, "framing_runs"], 0)
        self.assertTrue(pd.isna(result.loc[4, "framing_runs"]))
        self.assertTrue(pd.isna(result.loc[4, "framing_runs_percentile"]))
        self.assertEqual(fetch.call_args.args[1]["seasonStart"], 2025)
        self.assertEqual(fetch.call_args.args[1]["seasonEnd"], 2025)

    def test_catcher_collection_no_longer_requests_legacy_framing(self):
        with patch.object(repair, "safe_csv_get", return_value=pd.DataFrame()) as fetch:
            repair.fetch_catcher_all(2025)
        self.assertNotIn("/leaderboard/catcher-framing", [c.args[0] for c in fetch.call_args_list])

if __name__ == '__main__':
    unittest.main()
