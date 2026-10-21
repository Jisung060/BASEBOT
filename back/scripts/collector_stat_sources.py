"""Published WAR data and missing-value-only enrichment for season collectors."""
import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import pandas as pd
import requests


def _fetch_bref_http(season: int, is_pitcher: bool, headers: dict) -> pd.DataFrame:
    """Baseball-Reference's public WAR CSV, matched by MLB ID (never names)."""
    columns = ["player_id", "bwar"]
    role = "pitch" if is_pitcher else "bat"
    try:
        response = requests.get(
            f"https://www.baseball-reference.com/data/war_daily_{role}.txt",
            headers=headers, timeout=(5, 15),
        )
        response.raise_for_status()
        frame = pd.read_csv(io.StringIO(response.text))
        return normalize_bref_war(frame, season, "baseball_reference_http")
    except (requests.RequestException, ValueError, KeyError, pd.errors.ParserError) as exc:
        print(f"[FALLBACK] Baseball-Reference bWAR unavailable: {exc}")
        return pd.DataFrame(columns=columns)


def overlay_official_percentiles(frame: pd.DataFrame, official: pd.DataFrame) -> pd.DataFrame:
    """Override estimates only for published finite values, including zero."""
    if official.empty:
        return frame
    result = frame.set_index("player_id")
    published = official.drop_duplicates("player_id").set_index("player_id").reindex(result.index)
    for column in published:
        if not column.endswith("percentile"):
            continue
        values = pd.to_numeric(published[column], errors="coerce")
        values = values.where(values.between(0, 100))
        if column in result:
            result[column] = values.combine_first(result[column])
        else:
            result[column] = values
        source_col = f"{column}__source"
        result.loc[values.notna(), source_col] = published.get(source_col, pd.Series("savant_csv", index=result.index))[values.notna()]
    return result.reset_index()


SOURCE_DIR = Path(os.getenv("BASEBOT_STAT_SOURCE_DIR", str(Path(__file__).resolve().parents[1] / "data" / "stat_sources")))


def normalize_bref_war(frame, season, source):
    frame = frame.copy()
    frame.columns = frame.columns.str.strip().str.lower()
    frame = frame[pd.to_numeric(frame["year_id"], errors="coerce").eq(season)].copy()
    frame["player_id"] = pd.to_numeric(frame["mlb_id"], errors="coerce")
    frame["bwar"] = pd.to_numeric(frame["war"], errors="coerce").replace([float("inf"), -float("inf")], float("nan"))
    frame = frame.dropna(subset=["player_id", "bwar"])
    frame = frame[frame.player_id.gt(0) & frame.player_id.mod(1).eq(0)]
    rows = []
    for player_id, group in frame.groupby("player_id"):
        # Some exports include a season total plus team stints; don't add both.
        teams = group.get("team_id", pd.Series("", index=group.index)).astype(str)
        totals = group[teams.str.fullmatch(r"TOT|[2-9]TM", case=False)]
        if not totals.empty:
            value = totals.iloc[0]["bwar"]
        else:
            keys = [key for key in ("team_id", "stint_id") if key in group]
            stints = group.drop_duplicates(keys) if keys else group
            if not keys and len(stints) > 1:
                continue
            value = stints["bwar"].sum(min_count=1)
        rows.append({"player_id": int(player_id), "bwar": round(float(value), 1)})
    result = pd.DataFrame(rows, columns=["player_id", "bwar"])
    result["bwar__source"] = source
    return result


def normalize_fangraphs(frame, season, is_pitcher, source, allow_lookup=True):
    frame = frame.copy()
    if "Season" in frame:
        frame = frame[pd.to_numeric(frame["Season"], errors="coerce").eq(season)].copy()
    elif "season" in frame:
        frame = frame[pd.to_numeric(frame["season"], errors="coerce").eq(season)].copy()
    id_col = next((c for c in ("player_id", "xMLBAMID", "MLBAMID", "mlbamid") if c in frame), None)
    if id_col:
        frame["player_id"] = pd.to_numeric(frame[id_col], errors="coerce")
    elif "IDfg" in frame:
        frame["IDfg"] = pd.to_numeric(frame["IDfg"], errors="coerce")
        if allow_lookup:
            import pybaseball
            mapping = pybaseball.playerid_reverse_lookup(frame["IDfg"].dropna().astype(int).tolist(), key_type="fangraphs")
        else:
            mapping = pd.read_csv(SOURCE_DIR / "player_id_map.csv")
        mapping = mapping[["key_fangraphs", "key_mlbam"]].apply(pd.to_numeric, errors="coerce").dropna()
        mapping = mapping[(mapping.key_mlbam > 0) & (mapping.key_fangraphs > 0)]
        if mapping.key_fangraphs.duplicated().any():
            raise ValueError("ambiguous FanGraphs/MLB ID mapping")
        frame = frame.merge(mapping, left_on="IDfg", right_on="key_fangraphs", how="left")
        frame["player_id"] = frame["key_mlbam"]
    else:
        raise ValueError("CSV requires MLB player_id or IDfg plus player_id_map.csv")
    result = pd.DataFrame({"player_id": frame["player_id"]})
    aliases = {"fwar": ("fwar", "WAR"), **({"fip": ("fip", "FIP")} if is_pitcher else {"wrc_plus": ("wrc_plus", "wRC+")})}
    for target, choices in aliases.items():
        column = next((c for c in choices if c in frame), None)
        result[target] = pd.to_numeric(frame[column], errors="coerce") if column else float("nan")
        result[target] = result[target].replace([float("inf"), -float("inf")], float("nan"))
        result[target] = result[target].round({"fwar": 1, "fip": 2, "wrc_plus": 0}[target])
        result[f"{target}__source"] = source
    result = result.dropna(subset=["player_id"])
    result = result[result.player_id.gt(0) & result.player_id.mod(1).eq(0)].copy()
    if result.player_id.duplicated().any():
        raise ValueError("FanGraphs CSV must have one season-total row per MLB player")
    result["player_id"] = result.player_id.astype(int)
    return result


def _query_pybaseball_stats(season, is_pitcher, provider):
    try:
        import pybaseball
        if provider == "bref":
            function = pybaseball.bwar_pitch if is_pitcher else pybaseball.bwar_bat
            return normalize_bref_war(function(return_all=True), season, "baseball_reference_pybaseball")
        function = pybaseball.pitching_stats if is_pitcher else pybaseball.batting_stats
        return normalize_fangraphs(function(season, season, qual=0), season, is_pitcher, "fangraphs_pybaseball")
    except Exception as exc:
        print(f"[FALLBACK] pybaseball {provider}: {exc}")
        return pd.DataFrame()


def fetch_pybaseball_stats(season, is_pitcher, provider):
    # pybaseball transports do not consistently expose request timeouts.
    # A child process bounds network waits and can be terminated cleanly.
    try:
        SOURCE_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=SOURCE_DIR) as folder:
            destination = Path(folder) / "result.json"
            subprocess.run(
                [sys.executable, str(Path(__file__).resolve()), "--pybaseball", str(season),
                 str(int(is_pitcher)), provider, str(destination)],
                timeout=30, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            return pd.read_json(destination, orient="table")
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"[FALLBACK] bounded pybaseball {provider}: {exc}")
        return pd.DataFrame()


def fill_stat_gaps(primary, secondary):
    if secondary.empty:
        return primary
    if primary.empty:
        return secondary
    left = primary.set_index("player_id")
    right = secondary.set_index("player_id")
    left = left.reindex(left.index.union(right.index))
    for column in right:
        if column.endswith("__source"):
            continue
        if column not in left:
            left[column] = float("nan")
        missing = left[column].isna()
        left[column] = left[column].combine_first(right[column])
        source_col = f"{column}__source"
        if source_col in right:
            if source_col not in left:
                left[source_col] = None
            left.loc[missing, source_col] = right[source_col].reindex(left.index)[missing]
    return left.reset_index()


def read_local_stats(provider, season, is_pitcher):
    role = "pitching" if is_pitcher else "batting"
    path = SOURCE_DIR / f"{provider}_{role}_{season}.csv"
    if not path.is_file():
        return pd.DataFrame()
    try:
        metadata_path = path.with_suffix(".meta.json")
        if metadata_path.is_file():
            import json, hashlib
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata["sha256"] != hashlib.sha256(path.read_bytes()).hexdigest() or metadata["season"] != season:
                raise ValueError("Local source checksum/season mismatch")
        frame = pd.read_csv(path, encoding="utf-8-sig")
        if provider == "bref":
            return normalize_bref_war(frame, season, f"local_csv:{path.name}")
        return normalize_fangraphs(frame, season, is_pitcher, f"local_csv:{path.name}", allow_lookup=False)
    except Exception as exc:
        print(f"[SKIP] invalid local source {path}: {exc}")
        return pd.DataFrame()


def fetch_bref_war(season, is_pitcher, headers):
    result = fetch_pybaseball_stats(season, is_pitcher, "bref")
    if result.empty:
        result = _fetch_bref_http(season, is_pitcher, headers)
    return fill_stat_gaps(result, read_local_stats("bref", season, is_pitcher))


def fetch_fangraphs_http(season, is_pitcher=False):
    response = requests.get(
        "https://www.fangraphs.com/api/leaders/major-league/data",
        params={"stats": "pit" if is_pitcher else "bat", "pos": "all", "lg": "all",
                "qual": 0, "season": season, "season1": season, "month": 0,
                "team": 0, "pageitems": 10000, "pagenum": 1, "ind": 0,
                "type": "c,fip,war" if is_pitcher else "c,wrcplus,war"},
        headers={"User-Agent": "Mozilla/5.0"}, timeout=(5, 15))
    response.raise_for_status()
    return pd.DataFrame(response.json().get("data", []))


def fetch_fangraphs_with_fallback(season, is_pitcher, http_fetch, save_snapshot=True, local_fallback=True):
    result = fetch_pybaseball_stats(season, is_pitcher, "fangraphs")
    metrics = ("fwar", "fip") if is_pitcher else ("fwar", "wrc_plus")
    if result.empty or any(result[c].isna().any() for c in metrics):
        try:
            raw = http_fetch(season, is_pitcher) if http_fetch is fetch_fangraphs_http else http_fetch(season)
            if not raw.empty:
                result = fill_stat_gaps(result, normalize_fangraphs(raw, season, is_pitcher, "fangraphs_http"))
        except (requests.RequestException, ValueError, KeyError) as exc:
            print(f"[FALLBACK] FanGraphs HTTP: {exc}")
    local = read_local_stats("fangraphs", season, is_pitcher) if local_fallback else pd.DataFrame()
    if save_snapshot and not result.empty:
        try:
            from scripts import prepare_source_csvs as prepare
            role = "pitching" if is_pitcher else "batting"
            spec = next(s for s in prepare.source_specs(season) if s["name"] == f"fangraphs_{role}")
            # Keep older published values when an online response omits players or metrics.
            snapshot = fill_stat_gaps(result, local).copy()
            snapshot = snapshot.drop(columns=[c for c in snapshot if c.endswith("__source")])
            snapshot["season"] = season
            prepare.write_snapshot(snapshot.to_csv(index=False).encode("utf-8"), spec, directory=SOURCE_DIR)
        except (OSError, ValueError, KeyError) as exc:
            print(f"[WARN] FanGraphs snapshot not saved: {exc}")
    return fill_stat_gaps(result, local)


def request_csv(url, headers=None, timeout=(5, 20), params=None):
    """Online first; use only a validated prepared snapshot after failure."""
    try:
        response = requests.get(url, headers=headers, timeout=timeout, params=params)
        response.raise_for_status()
        if response.text.lstrip("\ufeff \r\n\t").startswith("<"):
            raise ValueError("HTML returned instead of CSV")
        frame = pd.read_csv(io.StringIO(response.text))
        if frame.empty:
            raise ValueError("Empty CSV")
        # Registered sources have stronger year/column validation.
        from scripts.prepare_source_csvs import source_specs, request_key, validate_csv
        from urllib.parse import parse_qsl, urlsplit
        query=dict(parse_qsl(urlsplit(url).query)); query.update(params or {})
        season=next((int(query[k]) for k in ("year", "seasonStart", "startYear") if k in query), None)
        spec=next((s for s in source_specs(season) if request_key(s["url"],s["params"])==request_key(url,params)), None) if season else None
        if spec:
            validate_csv(response.text.encode("utf-8"),spec)
        response.stat_source = "savant_csv"
        return response
    except (requests.RequestException, ValueError, pd.errors.ParserError) as exc:
        from scripts.prepare_source_csvs import read_prepared_for_request
        frame = read_prepared_for_request(url, params)
        if frame.empty:
            raise ValueError(f"Online CSV and prepared fallback unavailable: {exc}") from exc
        from types import SimpleNamespace
        print(f"[LOCAL] {frame.attrs['source']}")
        return SimpleNamespace(text=frame.to_csv(index=False), status_code=200,
                               stat_source=frame.attrs['source'], raise_for_status=lambda: None)


def read_lahman_basics(season, is_pitcher):
    """Offline basic-stat fallback, using an explicit Lahman/BRef/MLB ID crosswalk.

    Lahman does not supply provider-specific WAR or Statcast percentiles.
    Team codes are deliberately not guessed as MLB numeric team IDs.
    """
    folder = SOURCE_DIR / "lahman"
    try:
        stats = pd.read_csv(folder / ("Pitching.csv" if is_pitcher else "Batting.csv"))
        people = pd.read_csv(folder / "People.csv")
        mapping = pd.read_csv(SOURCE_DIR / "player_id_map.csv")
        stats = stats[pd.to_numeric(stats["yearID"], errors="coerce").eq(season)]
        stats = stats[stats["lgID"].isin(["AL", "NL"])]
        fields = ("G", "W", "L", "IPouts", "SO", "BB", "HBP", "HR", "H", "ER") if is_pitcher else ("G", "AB", "H", "2B", "3B", "HR", "RBI", "SB", "BB", "SO", "HBP", "SH", "SF")
        for column in fields:
            if column not in stats:
                raise ValueError(f"Missing Lahman field {column}")
            stats[column] = pd.to_numeric(stats[column], errors="coerce")
        totals = stats.groupby("playerID", as_index=False)[list(fields)].sum(min_count=1)
        totals = totals.merge(people[["playerID", "bbrefID", "nameFirst", "nameLast"]], on="playerID", validate="one_to_one")
        mapping = mapping[["key_bbref", "key_mlbam"]].drop_duplicates()
        totals = totals.merge(mapping, left_on="bbrefID", right_on="key_bbref", validate="many_to_one")
        rows = []
        for _, row in totals.iterrows():
            if any(pd.isna(row[c]) for c in fields):
                continue
            player_id = pd.to_numeric(row["key_mlbam"], errors="coerce")
            if pd.isna(player_id) or player_id <= 0 or player_id % 1:
                continue
            record = {"player_id": int(player_id), "player_name": f"{row.nameFirst} {row.nameLast}",
                      "team_id": None, "games": row.G, "walks": row.BB, "strikeouts": row.SO}
            if is_pitcher:
                outs = row.IPouts
                if outs < 30 or pd.isna(outs):
                    continue
                innings = outs / 3
                record.update(wins=row.W, losses=row.L, era=round(27*row.ER/outs, 2),
                              innings_pitched=int(outs//3)+(outs%3)/10,
                              hit_by_pitch=row.HBP, home_runs_allowed=row.HR,
                              whip=round((row.H+row.BB)/innings, 2))
            else:
                if row.AB < 20 or pd.isna(row.AB):
                    continue
                obp_den = row.AB + row.BB + row.HBP + row.SF
                obp = (row.H+row.BB+row.HBP)/obp_den if obp_den else 0
                slg = (row.H+row["2B"]+2*row["3B"]+3*row.HR)/row.AB
                record.update(at_bats=row.AB, hits=row.H, home_runs=row.HR, rbi=row.RBI,
                              stolen_bases=row.SB, plate_appearances=obp_den+row.SH,
                              batting_avg=round(row.H/row.AB, 3), obp=round(obp, 3),
                              slg=round(slg, 3), ops=round(obp+slg, 3))
            rows.append(record)
        print(f"[LOCAL] Lahman basics: {len(rows)} players ({season})")
        return pd.DataFrame(rows)
    except (OSError, ValueError, KeyError, pd.errors.ParserError) as exc:
        print(f"[FALLBACK] Lahman basics unavailable: {exc}")
        return pd.DataFrame()


if __name__ == "__main__" and len(sys.argv) == 6 and sys.argv[1] == "--pybaseball":
    _query_pybaseball_stats(int(sys.argv[2]), bool(int(sys.argv[3])), sys.argv[4]).to_json(sys.argv[5], orient="table")
