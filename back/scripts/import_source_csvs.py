"""Offline CSV repair: replace missing, estimated or unverified values with validated originals."""
import argparse
import json
import math
from pathlib import Path
import re
import sys
import pandas as pd
from sqlalchemy import inspect, text

BACK = Path(__file__).resolve().parents[1]
if str(BACK) not in sys.path:
    sys.path.insert(0, str(BACK))
from scripts import prepare_source_csvs as prepare
from scripts import collector_stat_sources as sources
from scripts.collector_savant_value_repair import normalize_official_percentiles, norm_columns
from scripts.stat_provenance import ensure_provenance_table, save_provenance, finite

ALIASES = {
    'avg_exit_velocity': ('exit_velocity_avg',), 'launch_angle_avg': ('launch_angle_avg',),
    'sweet_spot_percentage': ('sweet_spot_percent',), 'barrel_percentage': ('barrel_batted_rate',),
    'hard_hit_percentage': ('hard_hit_percent',), 'xba': ('xba',), 'xslg': ('xslg',),
    'xwoba': ('xwoba',), 'xera': ('xera',), 'sprint_speed': ('sprint_speed',),
    'whiff_percentage': ('whiff_percent',), 'chase_percentage': ('oz_swing_percent', 'chase_percent'),
    'k_percentage': ('k_percent',), 'bb_percentage': ('bb_percent',),
    'gb_percentage': ('groundballs_percent',), 'pitch_extension': ('release_extension',),
    'fastball_velocity': ('ff_avg_speed',), 'fielding_run_value': ('total_runs',),
    'arm_value': ('runs_arm', 'arm_runs'), 'framing_runs': ('framing_runs',),
    'outs_above_average': ('oaa','outs_above_average','n_outs_above_average'),
    'baserunning_run_value': ('runner_runs_tot','baserunning_run_value','baserunning_runs'),
    'arm_strength': ('arm_overall','arm_strength','arm'),
    'blocks_above_average': ('blocks_above_average','n_blocks_above_average','diff_runner_pb_wp'),
    'cs_above_average': ('cs_above_average','n_cs_above_average','caught_stealing_above_average'),
    'pop_time': ('pop_2b_sba','pop_2b','pop_time'),
    'games': ('gamesplayed',), 'plate_appearances': ('plateappearances',),
    'at_bats': ('atbats',), 'hits': ('hits',), 'home_runs': ('homeruns',), 'rbi': ('rbi',),
    'stolen_bases': ('stolenbases',), 'batting_avg': ('avg',), 'obp': ('obp',),
    'slg': ('slg',), 'ops': ('ops',), 'walks': ('baseonballs',), 'strikeouts': ('strikeouts',),
    'wins': ('wins',), 'losses': ('losses',), 'era': ('era',),
    'innings_pitched': ('inningspitched',), 'hit_by_pitch': ('hitbypitch',),
    'home_runs_allowed': ('homeruns',), 'whip': ('whip',),
    'bat_speed': ('avg_bat_speed',), 'squared_up_percentage': ('squared_up_per_swing',),
    **{f'{group}_run_value': (f'pitch_run_value_{group}',) for group in ('fastball', 'breaking', 'offspeed')},
}


def map_snapshot(frame, spec, is_pitcher):
    name = spec['name']
    label = f"local_csv:{spec['filename']}"
    if name.startswith('fangraphs_'):
        return sources.normalize_fangraphs(frame, spec['season'], is_pitcher, label, allow_lookup=False)
    if name.startswith('bref_'):
        return sources.normalize_bref_war(frame, spec['season'], label)
    if name.startswith('savant_percentiles_'):
        return normalize_official_percentiles(frame, 'pitcher' if is_pitcher else 'batter', label)
    frame = norm_columns(frame)
    id_column = next(c for c in ('player_id', 'entity_id', 'id', 'catcher_id') if c in frame)
    result = pd.DataFrame({'player_id': pd.to_numeric(frame[id_column], errors='coerce')})
    aliases = ALIASES
    if name.endswith('_run_value'):
        aliases = {'pitching_run_value' if is_pitcher else 'batting_run_value': ('runs_all',)}
    scoped = {
        'savant_oaa': {'outs_above_average'},
        'savant_baserunning': {'baserunning_run_value'},
        'savant_arm_strength': {'arm_strength'},
        'savant_catcher_blocking': {'blocks_above_average'},
        'savant_catcher_throwing': {'cs_above_average'},
        'savant_catcher_poptime': {'pop_time'},
    }
    for target, candidates in aliases.items():
        if name in scoped and target not in scoped[name]:
            continue
        if name == 'mlb_batting' and target in ('home_runs_allowed','wins','losses','era','innings_pitched','whip'):
            continue
        if name == 'mlb_pitching' and target in ('home_runs','batting_avg','obp','slg','ops','at_bats','rbi','stolen_bases','plate_appearances'):
            continue
        column = next((c for c in candidates if c in frame), None)
        if column is None:
            continue
        values = pd.to_numeric(frame[column], errors='coerce').replace([float('inf'), -float('inf')], float('nan'))
        if target == 'squared_up_percentage':
            values = values * 100
        result[target] = values
        result[f'{target}__source'] = label
    result = result[result.player_id.gt(0) & result.player_id.mod(1).eq(0)].copy()
    if result.player_id.duplicated().any():
        raise ValueError('Duplicate MLB player IDs in snapshot')
    return result


def load_frames(season):
    frames = {False: pd.DataFrame(), True: pd.DataFrame()}
    reports = []
    for spec in prepare.source_specs(season):
        try:
            frame = prepare.read_prepared(spec)
            is_pitcher = 'pitcher' in spec['name'] or spec['name'] in ('fangraphs_pitching', 'bref_pitching', 'mlb_pitching', 'savant_pitch_run_values')
            mapped = map_snapshot(frame, spec, is_pitcher)
            frames[is_pitcher] = sources.fill_stat_gaps(frames[is_pitcher], mapped)
            metrics = [c for c in mapped if c != 'player_id' and not c.endswith('__source') and mapped[c].notna().any()]
            reports.append({'file': spec['filename'], 'status': 'ready', 'rows': len(mapped), 'metrics': metrics})
        except (OSError, ValueError, KeyError, StopIteration, pd.errors.ParserError) as exc:
            reports.append({'file': spec['filename'], 'status': 'unavailable', 'error': str(exc)[:200]})
    return frames, reports


def apply_frames(engine, frames, season):
    columns = {c['name'] for c in inspect(engine).get_columns('player_season_stats')}
    ensure_provenance_table(engine)
    updated = set()
    cells = 0
    source_updates = 0
    with engine.begin() as conn:
        for role, frame in frames.items():
            metrics = [c for c in frame if c in columns and c != 'player_id' and re.fullmatch('[a-z_]+', c)]
            if not metrics or frame.empty:
                continue
            lock = ' FOR UPDATE' if engine.dialect.name == 'mysql' else ''
            previous = conn.execute(text('SELECT player_id, '+', '.join(metrics)+' FROM player_season_stats WHERE season=:season AND is_pitcher=:role'+lock), {'season': season, 'role': role}).mappings().all()
            old_rows = {int(row['player_id']): row for row in previous}
            metadata = conn.execute(text('SELECT player_id, metric, source, stored_value FROM player_stat_provenance WHERE season=:season AND is_pitcher=:role'), {'season': season, 'role': role}).mappings().all()
            origins = {(int(r['player_id']), r['metric']): r for r in metadata}
            records = []
            for _, row in frame.iterrows():
                pid = int(row['player_id'])
                if pid not in old_rows:
                    continue
                for metric in metrics:
                    value = row[metric]
                    if not finite(value):
                        continue
                    source = row.get(f'{metric}__source')
                    if not isinstance(source, str) or not source.startswith('local_csv:'):
                        continue
                    old = old_rows[pid][metric]
                    origin = origins.get((pid, metric))
                    verified = origin and finite(old) and finite(origin['stored_value']) and math.isclose(float(old), float(origin['stored_value']), rel_tol=1e-9, abs_tol=1e-6)
                    old_source = origin['source'] if verified else None
                    if finite(old) and old_source not in (None, 'estimated', 'legacy_unknown'):
                        continue
                    same_value = finite(old) and math.isclose(float(old), float(value), rel_tol=1e-9, abs_tol=1e-6)
                    stored_value = float(old) if same_value else float(value)
                    if not same_value:
                        # Recheck the old value to avoid racing another collector.
                        result = conn.execute(text(f'UPDATE player_season_stats SET {metric}=:value WHERE player_id=:pid AND season=:season AND is_pitcher=:role AND ({metric}=:old OR ({metric} IS NULL AND :old IS NULL))'), {'value':stored_value,'pid':pid,'season':season,'role':role,'old':float(old) if finite(old) else None})
                        if not result.rowcount:
                            continue
                        cells += 1
                    updated.add((pid, role))
                    source_updates += 1
                    records.append({'player_id':pid,'season':season,'is_pitcher':role,'metric':metric,'source':source,'value':stored_value})
            save_provenance(conn, records)
    return {'updated_rows': len(updated), 'updated_values': cells, 'updated_sources': source_updates}


def import_source_csvs(season, apply=False):
    frames, files = load_frames(season)
    summary = {'season': season, 'mode': 'apply' if apply else 'dry_run', 'files': files,
               'ready_files': sum(f['status']=='ready' for f in files),
               'unavailable_files': sum(f['status']=='unavailable' for f in files),
               'updated_rows': 0, 'updated_values': 0, 'updated_sources': 0}
    if apply:
        if not summary['ready_files']:
            raise ValueError('No validated source CSV files to import')
        from database.db_connection import engine
        summary.update(apply_frames(engine, frames, season))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season', required=True, type=int)
    parser.add_argument('--apply', action='store_true', help='Write existing DB rows; default only validates CSVs')
    args = parser.parse_args()
    result = import_source_csvs(args.season, args.apply)
    raise SystemExit(0 if result['ready_files'] else 1)
