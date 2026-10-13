"""Repair Savant OAA, run-value and velocity columns in player_season_stats.

Copy this file to BASEBOT/back/scripts or run it with --project-root pointing
at the BASEBOT directory.  It deliberately uses separate official leaderboard
endpoints instead of the Custom Leaderboard for metrics that are not custom
columns.
"""

from __future__ import annotations

import argparse
import io
import math
import sys
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
from sqlalchemy import text


BASE = "https://baseballsavant.mlb.com"
MLB_STATS_API = "https://statsapi.mlb.com/api/v1/stats"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/csv,text/plain,*/*",
}


def norm_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).replace("\ufeff", "").strip().lower() for c in df.columns]
    return df


def csv_get(session: requests.Session, path: str, params: dict) -> pd.DataFrame:
    response = session.get(BASE + path, params={**params, "csv": "true"}, timeout=45)
    response.raise_for_status()
    if not response.text.strip():
        raise RuntimeError(f"empty CSV response: {response.url}")
    df = norm_columns(pd.read_csv(io.StringIO(response.text)))
    if len(df.columns) == 0 or len(df) == 0:
        raise RuntimeError(f"CSV has no rows: {response.url}; columns={list(df.columns)}")
    print(f"{path}: {len(df)} rows; {list(df.columns)}")
    return df


def first_column(df: pd.DataFrame, names: Iterable[str]) -> str:
    for name in names:
        if name in df.columns:
            return name
    raise KeyError(f"none of {list(names)} found; received {list(df.columns)}")


def player_ids(df: pd.DataFrame) -> pd.Series:
    col = first_column(df, ("player_id", "entity_id", "id", "pitcher"))
    return pd.to_numeric(df[col], errors="coerce")


def percentile(series: pd.Series) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce")
    # Percentile here is the project's within-leaderboard percentile, not a
    # claim that Savant's player-page percentile was returned by this CSV.
    return (values.rank(method="average", pct=True) * 100).round().astype("Int64")


def fetch_oaa(s: requests.Session, season: int) -> pd.DataFrame:
    df = csv_get(
        s,
        "/leaderboard/outs_above_average",
        {
            "type": "Fielder",
            "startYear": season,
            "endYear": season,
            "split": "no",
            "team": "",
            "range": "year",
            "min": 1,
            "pos": "",
            "roles": "",
            "viz": "hide",
        },
    )
    print(f"OAA headers: {list(df.columns)}")
    out = pd.DataFrame({"player_id": player_ids(df)})
    value_col = first_column(df, ("oaa", "outs_above_average", "n_outs_above_average"))
    out["outs_above_average"] = pd.to_numeric(df[value_col], errors="coerce")
    out = out.dropna(subset=["player_id", "outs_above_average"])
    out["player_id"] = out["player_id"].astype(int)
    out["outs_above_average"] = out["outs_above_average"].round().astype(int)
    out["oaa_percentile"] = percentile(out["outs_above_average"])
    return out.drop_duplicates("player_id")


def fetch_swing_take(s: requests.Session, season: int, group: str, value_name: str) -> pd.DataFrame:
    df = csv_get(
        s,
        "/leaderboard/swing-take",
        {
            "year": season,
            "team": "",
            "leverage": "Neutral",
            "group": group,
            "type": "All",
            "sub_type": "null",
            "min": "q",
        },
    )
    out = pd.DataFrame({"player_id": player_ids(df)})
    value_col = first_column(df, ("runs_all",))
    out[value_name] = pd.to_numeric(df[value_col], errors="coerce")
    out = out.dropna(subset=["player_id", value_name])
    out["player_id"] = out["player_id"].astype(int)
    # The SQL schema supplied by the user defines these three columns as INT.
    out[value_name] = out[value_name].round().astype(int)
    out[f"{value_name}_percentile"] = percentile(out[value_name])
    return out.drop_duplicates("player_id")


def fetch_baserunning(s: requests.Session, season: int) -> pd.DataFrame:
    df = csv_get(
        s,
        "/leaderboard/baserunning-run-value",
        {
            "game_type": "Regular",
            "n": 1,
            "season_start": season,
            "season_end": season,
            "sortColumn": "runner_runs_tot",
            "sortDirection": "desc",
            "split": "no",
            "team": "",
            "type": "Run",
            "with_team_only": 1,
        },
    )
    out = pd.DataFrame({"player_id": player_ids(df)})
    value_col = first_column(
        df,
        ("runner_runs_tot", "baserunning_run_value", "baserunning_runs", "runs"),
    )
    out["baserunning_run_value"] = pd.to_numeric(df[value_col], errors="coerce")
    out = out.dropna(subset=["player_id", "baserunning_run_value"])
    out["player_id"] = out["player_id"].astype(int)
    out["baserunning_run_value"] = out["baserunning_run_value"].round().astype(int)
    out["baserunning_run_value_percentile"] = percentile(out["baserunning_run_value"])
    return out.drop_duplicates("player_id")


def fetch_arm_strength(s: requests.Session, season: int) -> pd.DataFrame:
    df = csv_get(
        s,
        "/leaderboard/arm-strength",
        {"type": "player", "year": season, "pos": "", "team": "", "minThrows": 5},
    )
    out = pd.DataFrame({"player_id": player_ids(df)})
    # Current Savant CSV calls the all-position value `arm_overall`.
    # Older responses used `arm_strength`/`arm`, so retain those aliases.
    value_col = first_column(df, ("arm_overall", "arm_strength", "arm"))
    out["arm_strength"] = pd.to_numeric(df[value_col], errors="coerce")
    out = out.dropna(subset=["player_id", "arm_strength"])
    out["player_id"] = out["player_id"].astype(int)
    out["arm_strength_percentile"] = percentile(out["arm_strength"])
    return out.drop_duplicates("player_id")


def fetch_fastball_velocity(s: requests.Session, season: int) -> pd.DataFrame:
    df = csv_get(s, "/leaderboard/pitch-arsenals", {"year": season})
    out = pd.DataFrame({"player_id": player_ids(df)})
    value_col = first_column(df, ("ff_avg_speed", "fastball_velocity"))
    out["fastball_velocity"] = pd.to_numeric(df[value_col], errors="coerce")
    out = out.dropna(subset=["player_id", "fastball_velocity"])
    out["player_id"] = out["player_id"].astype(int)
    out["fastball_velo_percentile"] = percentile(out["fastball_velocity"])
    return out.drop_duplicates("player_id")


def fetch_pitcher_k_bb(s: requests.Session, season: int) -> pd.DataFrame:
    """Fetch official pitcher K% and BB% from MLB season pitching stats.

    Savant's pitcher page defines both rates against batters faced, rather
    than innings pitched.  The Stats API exposes all three required counts.
    """
    response = s.get(
        MLB_STATS_API,
        params={
            "stats": "season",
            "season": season,
            "group": "pitching",
            "sportId": 1,
            "limit": 1500,
        },
        timeout=45,
    )
    response.raise_for_status()
    splits = response.json().get("stats", [{}])[0].get("splits", [])

    rows = []
    for split in splits:
        player = split.get("player", {})
        stat = split.get("stat", {})
        player_id = player.get("id")
        batters_faced = pd.to_numeric(stat.get("battersFaced"), errors="coerce")
        strikeouts = pd.to_numeric(stat.get("strikeOuts"), errors="coerce")
        walks = pd.to_numeric(stat.get("baseOnBalls"), errors="coerce")
        if player_id is None or pd.isna(batters_faced) or batters_faced <= 0:
            continue
        rows.append(
            {
                "player_id": int(player_id),
                "bb_percentage": float(walks / batters_faced * 100),
                "k_percentage": float(strikeouts / batters_faced * 100),
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        print(f"SKIP no pitcher K%/BB% rows returned for {season}")
        return out
    print(f"MLB pitcher K%/BB%: {len(out)} rows")
    return out.drop_duplicates("player_id")


def fetch_official_percentiles(s: requests.Session, season: int, player_type: str) -> pd.DataFrame:
    """Fetch Savant's own percentile leaderboard instead of ranking local data.

    The exact CSV labels have changed over time, so aliases are intentional.
    Missing metrics are omitted rather than written as NULL over an existing
    value.
    """
    df = csv_get(
        s,
        "/leaderboard/percentile-rankings",
        {"type": player_type, "year": season, "position": "", "team": ""},
    )
    ids = player_ids(df)
    out = pd.DataFrame({"player_id": ids})
    out = out[(out["player_id"].notna()) & (out["player_id"] != 999999)].copy()
    out["player_id"] = out["player_id"].astype(int)

    aliases = {
        # Percentile Rankings CSV returns the displayed metric names (for
        # example `ev`, `brl_percent`, `oaa`), not *_percentile headers.
        "exit_velo_percentile": ("exit_velo_percentile", "exit_velocity_percentile", "ev_percentile", "ev"),
        "barrel_percentile": ("barrel_percentile", "barrel_rate_percentile", "brl_percentile", "barrel", "brl"),
        "hard_hit_percentile": ("hard_hit_percentile", "hardhit_percentile", "hard_hit", "hard_hit_percent"),
        "xwoba_percentile": ("xwoba_percentile", "xwoba_pct", "expected_woba_percentile", "xwoba"),
        "sprint_speed_percentile": ("sprint_speed_percentile", "sprint_percentile", "sprint_speed"),
        "oaa_percentile": ("oaa_percentile", "outs_above_average_percentile", "oaa"),
        "arm_strength_percentile": ("arm_strength_percentile", "arm_percentile", "arm_strength", "arm"),
    }
    for target, candidates in aliases.items():
        source = next((c for c in candidates if c in df.columns), None)
        if source is None:
            print(f"INFO official percentile column unavailable: {player_type}/{target}")
            continue
        out[target] = pd.to_numeric(df.loc[out.index, source], errors="coerce").to_numpy()
    return out.drop_duplicates("player_id")


def clean(value, integer: bool = False):
    if value is None or pd.isna(value):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return int(round(number)) if integer else number


def upsert_metric(
    engine,
    frame: pd.DataFrame,
    columns: list[str],
    is_pitcher: bool,
    dry_run: bool,
    preserve_existing: bool = False,
):
    if not columns:
        print("SKIP no target columns")
        return
    if frame.empty:
        print(f"SKIP empty frame: {columns}")
        return

    # player_season_stats.player_id has an FK to players.player_id.  Savant
    # leaderboards include historical/retired players that may not yet exist
    # in the application's players table, so never attempt an invalid child
    # insert.  Keep the skipped IDs visible for later player-table repair.
    with engine.connect() as connection:
        existing = pd.read_sql(
            text("SELECT player_id FROM players"), connection
        )["player_id"].astype("int64")
    existing_ids = set(existing.tolist())
    source_ids = set(frame["player_id"].astype(int).tolist())
    missing_ids = sorted(source_ids - existing_ids)
    if missing_ids:
        print(
            f"SKIP {len(missing_ids)} player IDs missing from players "
            f"for {columns}: {missing_ids[:20]}"
            + (" ..." if len(missing_ids) > 20 else "")
        )
        frame = frame[frame["player_id"].isin(existing_ids)].copy()
    if frame.empty:
        print(f"SKIP no FK-valid rows remain: {columns}")
        return

    if preserve_existing:
        # Fallback mode: fill only database NULLs; never replace an official
        # value with a locally calculated value.
        assignments = ", ".join(
            f"{column}=COALESCE({column}, VALUES({column}))" for column in columns
        )
    else:
        # Official-source mode: the source value takes precedence.  A NULL
        # source value still preserves the existing database value.
        assignments = ", ".join(
            f"{column}=COALESCE(VALUES({column}), {column})" for column in columns
        )
    statement = text(
        f"INSERT INTO player_season_stats "
        f"(player_id, season, is_pitcher, {', '.join(columns)}) "
        f"VALUES (:player_id, :season, :is_pitcher, {', '.join(':' + c for c in columns)}) "
        f"ON DUPLICATE KEY UPDATE {assignments}"
    )
    params = []
    for _, row in frame.iterrows():
        item = {
            "player_id": int(row.player_id),
            "season": int(row.season),
            "is_pitcher": bool(is_pitcher),
        }
        for column in columns:
            item[column] = clean(row[column], integer=column.endswith("percentile") or column in {
                "outs_above_average", "batting_run_value", "baserunning_run_value", "pitching_run_value"
            })
        params.append(item)
    if dry_run:
        print(f"DRY RUN {len(params)} rows: {columns}, pitcher={is_pitcher}")
        return
    with engine.begin() as connection:
        result = connection.execute(statement, params)
    print(f"UPSERT {result.rowcount} affected rows: {columns}, pitcher={is_pitcher}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2024)
    parser.add_argument("--project-root", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    project_root = args.project_root or Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(project_root))
    from database.db_connection import engine

    session = requests.Session()
    session.headers.update(HEADERS)
    season = args.season

    oaa = fetch_oaa(session, season).assign(season=season)
    batting = fetch_swing_take(session, season, "Batter", "batting_run_value").assign(season=season)
    pitching = fetch_swing_take(session, season, "Pitcher", "pitching_run_value").assign(season=season)
    baserunning = fetch_baserunning(session, season).assign(season=season)
    arm = fetch_arm_strength(session, season).assign(season=season)
    velocity = fetch_fastball_velocity(session, season).assign(season=season)
    pitcher_k_bb = fetch_pitcher_k_bb(session, season).assign(season=season)
    batter_percentiles = fetch_official_percentiles(session, season, "batter").assign(season=season)
    pitcher_percentiles = fetch_official_percentiles(session, season, "pitcher").assign(season=season)

    official_pct_columns = [
        "exit_velo_percentile",
        "barrel_percentile",
        "hard_hit_percentile",
        "xwoba_percentile",
        "sprint_speed_percentile",
        "oaa_percentile",
        "arm_strength_percentile",
    ]
    # Official percentile values are written first and take precedence.
    upsert_metric(
        engine,
        batter_percentiles,
        [c for c in official_pct_columns if c in batter_percentiles.columns],
        False,
        args.dry_run,
    )
    upsert_metric(
        engine,
        pitcher_percentiles,
        [c for c in official_pct_columns if c in pitcher_percentiles.columns],
        True,
        args.dry_run,
    )

    # The remaining values are fallbacks or metrics without an official
    # percentile CSV.  They only fill NULL database fields.
    upsert_metric(engine, oaa, ["outs_above_average"], False, args.dry_run, preserve_existing=True)
    upsert_metric(engine, batting, ["batting_run_value", "batting_run_value_percentile"], False, args.dry_run, preserve_existing=True)
    upsert_metric(engine, baserunning, ["baserunning_run_value", "baserunning_run_value_percentile"], False, args.dry_run, preserve_existing=True)
    upsert_metric(engine, pitching, ["pitching_run_value", "pitching_run_value_percentile"], True, args.dry_run, preserve_existing=True)
    upsert_metric(engine, arm, ["arm_strength"], False, args.dry_run, preserve_existing=True)
    upsert_metric(engine, velocity, ["fastball_velocity", "fastball_velo_percentile"], True, args.dry_run, preserve_existing=True)
    upsert_metric(
        engine,
        pitcher_k_bb,
        ["bb_percentage", "k_percentage"],
        True,
        args.dry_run,
        preserve_existing=False,
    )


if __name__ == "__main__":
    main()
