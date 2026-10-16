"""Collect Savant metrics concurrently, then update existing season rows."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import io
import json
import re
import math
import sys
import time
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

INTEGER_COLUMNS = {
    "outs_above_average",
    "arm_value",
    "batting_run_value",
    "baserunning_run_value",
    "fielding_run_value",
    "pitching_run_value",
    "fastball_run_value",
    "breaking_run_value",
    "offspeed_run_value",
    "blocks_above_average",
    "cs_above_average",
    "framing_runs",
}


def norm_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).replace("\ufeff", "").strip().lower() for c in df.columns]
    return df


def safe_csv_get(path: str, params: dict) -> pd.DataFrame:
    """개별 요청에 짧은 타임아웃(연결 5초, 읽기 12초)을 적용하여 무한 대기 원천 차단"""
    try:
        resp = requests.get(
            BASE + path,
            params={**params, "csv": "true"},
            headers=HEADERS,
            timeout=(5, 12)
        )
        if resp.status_code != 200 or not resp.text.strip():
            return pd.DataFrame()
        # HTML 에러 페이지가 반환된 경우 무시
        if resp.text.lstrip().lower().startswith(("<!doctype", "<html")):
            print(f"[SKIP] {path}: expected CSV, received HTML; check query parameters")
            return pd.DataFrame()
        df = norm_columns(pd.read_csv(io.StringIO(resp.text)))
        if len(df.columns) == 0 or len(df) == 0:
            return pd.DataFrame()
        print(f"[OK] {path} ({params.get('type') or params.get('group') or ''}): {len(df)} rows")
        return df
    except Exception as e:
        print(f"[SKIP] {path}: {e}")
        return pd.DataFrame()


def first_column(df: pd.DataFrame, names: Iterable[str]) -> str | None:
    for name in names:
        if name in df.columns:
            return name
    return None


def player_ids(df: pd.DataFrame) -> pd.Series:
    col = first_column(df, ("player_id", "entity_id", "id", "pitcher", "batter", "catcher_id"))
    if not col:
        col = df.columns[0]
    return pd.to_numeric(df[col], errors="coerce")


def percentile(series: pd.Series, ascending: bool = True) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce")
    return (values.rank(method="average", pct=True, ascending=ascending) * 100).round().astype("Int64")


# ---------------------------------------------------------
# 개별 리더보드 수집 함수들
# ---------------------------------------------------------
def fetch_oaa(season: int) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/outs_above_average", {
        "type": "Fielder", "startYear": season, "endYear": season,
        "split": "no", "team": "", "range": "year", "min": 1, "pos": "", "roles": "", "viz": "hide"
    })
    if df.empty:
        return pd.DataFrame()
    val_col = first_column(df, ("oaa", "outs_above_average", "n_outs_above_average"))
    if not val_col:
        return pd.DataFrame()
    out = pd.DataFrame({"player_id": player_ids(df), "raw": pd.to_numeric(df[val_col], errors="coerce")}).dropna()
    out["player_id"] = out["player_id"].astype(int)
    out["oaa_percentile"] = percentile(out["raw"], True)
    out["outs_above_average"] = out["raw"].round().astype(int)
    return out[["player_id", "outs_above_average", "oaa_percentile"]].drop_duplicates("player_id")


def fetch_fielding_and_arm_value(season: int) -> pd.DataFrame:
    """Savant Fielding Run Value 리더보드에서 종합 수비 가치(fielding_run_value) 및 외야 송구 가치(arm_value) 수집"""
    df = safe_csv_get("/leaderboard/fielding-run-value", {
        "type": "fielder", "seasonStart": season, "seasonEnd": season,
    })
    if df.empty:
        return pd.DataFrame()

    out = pd.DataFrame({"player_id": player_ids(df)})
    frv_col = first_column(df, ("total_runs", "runs_prevented", "fielding_run_value", "tot_runs", "runs_tot"))
    arm_col = first_column(df, ("runs_arm", "arm_value", "outfield_arm_runs", "arm_runs"))

    if frv_col:
        raw_frv = pd.to_numeric(df[frv_col], errors="coerce")
        out["fielding_run_value_percentile"] = percentile(raw_frv, True)
        out["fielding_run_value"] = raw_frv.round().astype("Int64")

    if arm_col:
        raw_arm = pd.to_numeric(df[arm_col], errors="coerce")
        out["arm_value_percentile"] = percentile(raw_arm, True)
        out["arm_value"] = raw_arm.round().astype("Int64")

    out = out.dropna(subset=["player_id"]).copy()
    out["player_id"] = out["player_id"].astype(int)
    return out.drop_duplicates("player_id")

def fetch_swing_take(season: int, group: str, value_name: str) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/swing-take", {
        "year": season, "team": "", "leverage": "Neutral",
        "group": group, "type": "All", "sub_type": "null", "min": "q"
    })
    if df.empty:
        return pd.DataFrame()
    val_col = first_column(df, ("runs_all",))
    if not val_col:
        return pd.DataFrame()
    out = pd.DataFrame({"player_id": player_ids(df), "raw": pd.to_numeric(df[val_col], errors="coerce")}).dropna()
    out["player_id"] = out["player_id"].astype(int)
    out[f"{value_name}_percentile"] = percentile(out["raw"], True)
    out[value_name] = out["raw"].round().astype(int)
    return out[["player_id", value_name, f"{value_name}_percentile"]].drop_duplicates("player_id")


def fetch_pitch_run_values(season: int) -> pd.DataFrame:
    columns = {f"{group}_run_value": f"pitch_run_value_{group}"
               for group in ("fastball", "breaking", "offspeed")}
    df = safe_csv_get("/leaderboard/custom", {
        "year": season, "type": "pitcher", "min": 10,
        "selections": ",".join(columns.values()),
    })
    if df.empty:
        return pd.DataFrame()
    out = pd.DataFrame({"player_id": player_ids(df)})
    for target, source in columns.items():
        if source not in df.columns:
            print(f"[SKIP] pitcher run values: missing column {source}")
            continue
        raw = pd.to_numeric(df[source], errors="coerce")
        out[target] = raw.round().astype("Int64")
        out[f"{target}_percentile"] = percentile(raw, True)
    out = out.dropna(subset=["player_id"]).copy()
    out["player_id"] = out["player_id"].astype(int)
    return out.drop_duplicates("player_id")


def fetch_pitcher_extension(player_id: int, season: int) -> dict:
    """The custom CSV leaves extension empty; use the player's season card."""
    try:
        response = requests.get(f"{BASE}/savant-player/{player_id}",
                                headers=HEADERS, timeout=(5, 12))
        response.raise_for_status()
        match = re.search(r"\bstatcast:\s*", response.text)
        if match is None:
            raise ValueError("missing statcast season data")
        seasons, _ = json.JSONDecoder().raw_decode(response.text[match.end():])
        candidates = [row for row in seasons
                      if str(row.get("year")) == str(season)
                      and row.get("player_type") == "pitcher"]
        # Never select an individual team split for a traded player's season.
        totals = [row for row in candidates if str(row.get("aggregate")) == "1"]
        if not totals and len(candidates) != 1:
            return {}
        row = (totals or candidates)[0]
        value = clean(pd.to_numeric(row.get("fastball_extension"), errors="coerce"))
        if value is None:
            return {}
        result = {"player_id": player_id, "pitch_extension": round(value, 1),
                  "extension_percentile": clean(pd.to_numeric(
                      row.get("percent_rank_fastball_extension"), errors="coerce"), integer=True)}
        for group in ("fastball", "breaking", "offspeed"):
            pct = clean(pd.to_numeric(row.get(f"percent_rank_pitch_run_value_{group}"),
                                      errors="coerce"), integer=True)
            if pct is not None:
                result[f"{group}_run_value_percentile"] = pct
        return result
    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
        print(f"[SKIP] pitcher extension {player_id}: {exc}")
        return {}


def fetch_baserunning(season: int) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/baserunning-run-value", {
        "game_type": "Regular", "n": 1, "season_start": season, "season_end": season,
        "sortColumn": "runner_runs_tot", "sortDirection": "desc", "split": "no",
        "team": "", "type": "Run", "with_team_only": 1
    })
    if df.empty:
        return pd.DataFrame()
    val_col = first_column(df, ("runner_runs_tot", "baserunning_run_value", "baserunning_runs", "runs"))
    if not val_col:
        return pd.DataFrame()
    out = pd.DataFrame({"player_id": player_ids(df), "raw": pd.to_numeric(df[val_col], errors="coerce")}).dropna()
    out["player_id"] = out["player_id"].astype(int)
    out["baserunning_run_value_percentile"] = percentile(out["raw"], True)
    out["baserunning_run_value"] = out["raw"].round().astype(int)
    return out[["player_id", "baserunning_run_value", "baserunning_run_value_percentile"]].drop_duplicates("player_id")


def fetch_arm_strength(season: int) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/arm-strength", {
        "type": "player", "year": season, "pos": "", "team": "", "minThrows": 5
    })
    if df.empty:
        return pd.DataFrame()
    val_col = first_column(df, ("arm_overall", "arm_strength", "arm"))
    if not val_col:
        return pd.DataFrame()
    out = pd.DataFrame({"player_id": player_ids(df), "arm_strength": pd.to_numeric(df[val_col], errors="coerce")}).dropna()
    out["player_id"] = out["player_id"].astype(int)
    out["arm_strength_percentile"] = percentile(out["arm_strength"], True)
    return out.drop_duplicates("player_id")


def fetch_bat_tracking(season: int) -> pd.DataFrame:
    if season < 2024:
        return pd.DataFrame()
    df = safe_csv_get("/leaderboard/bat-tracking", {"seasonStart": season, "seasonEnd": season, "minSwings": 0})
    if df.empty:
        df = safe_csv_get("/leaderboard/custom", {
            "year": season, "type": "batter", "min": 10,
            "selections": "player_id,avg_bat_speed,squared_up_rate"
        })
    if df.empty:
        return pd.DataFrame()

    out = pd.DataFrame({"player_id": player_ids(df)})
    bs_col = first_column(df, ("avg_bat_speed", "bat_speed", "swing_speed"))
    sq_col = first_column(df, ("squared_up_per_swing", "squared_up_rate", "squared_up_percent", "squared_up"))

    if bs_col:
        out["bat_speed"] = pd.to_numeric(df[bs_col], errors="coerce").round(1)
        out["bat_speed_percentile"] = percentile(out["bat_speed"], True)
    if sq_col:
        vals = pd.to_numeric(df[sq_col], errors="coerce")
        if not vals.dropna().empty and vals.dropna().max() <= 1.0:
            vals = (vals * 100.0).round(1)
        else:
            vals = vals.round(1)
        out["squared_up_percentage"] = vals
        out["squared_up_percentile"] = percentile(out["squared_up_percentage"], True)

    out = out.dropna(subset=["player_id"]).copy()
    out["player_id"] = out["player_id"].astype(int)
    return out.drop_duplicates("player_id")


def fetch_catcher_all(season: int) -> pd.DataFrame:
    merged = pd.DataFrame(columns=["player_id"])

    # Blocking
    df_blk = safe_csv_get("/leaderboard/catcher-blocking", {"year": season, "min": 1})
    if not df_blk.empty:
        c = first_column(df_blk, ("blocks_above_average", "n_blocks_above_average", "diff_runner_pb_wp"))
        if c:
            sub = pd.DataFrame({"player_id": player_ids(df_blk), "raw": pd.to_numeric(df_blk[c], errors="coerce")}).dropna()
            sub["player_id"] = sub["player_id"].astype(int)
            sub["blocks_above_average_percentile"] = percentile(sub["raw"], True)
            sub["blocks_above_average"] = sub["raw"].round().astype(int)
            merged = sub[["player_id", "blocks_above_average", "blocks_above_average_percentile"]].drop_duplicates("player_id")

    # Throwing (CS)
    df_cs = safe_csv_get("/leaderboard/catcher-throwing", {"year": season, "min": 1})
    if not df_cs.empty:
        c = first_column(df_cs, ("cs_above_average", "n_cs_above_average", "caught_stealing_above_average"))
        if c:
            sub = pd.DataFrame({"player_id": player_ids(df_cs), "raw": pd.to_numeric(df_cs[c], errors="coerce")}).dropna()
            sub["player_id"] = sub["player_id"].astype(int)
            sub["cs_above_average_percentile"] = percentile(sub["raw"], True)
            sub["cs_above_average"] = sub["raw"].round().astype(int)
            sub = sub[["player_id", "cs_above_average", "cs_above_average_percentile"]].drop_duplicates("player_id")
            merged = pd.merge(merged, sub, on="player_id", how="outer") if not merged.empty else sub

    # Framing
    df_frm = safe_csv_get("/leaderboard/catcher-framing", {"year": season, "min": 1})
    if not df_frm.empty:
        c = first_column(df_frm, ("runs_extra_strikes", "framing_runs", "shadow_runs", "runs"))
        if c:
            sub = pd.DataFrame({"player_id": player_ids(df_frm), "raw": pd.to_numeric(df_frm[c], errors="coerce")}).dropna()
            sub["player_id"] = sub["player_id"].astype(int)
            sub["framing_runs_percentile"] = percentile(sub["raw"], True)
            sub["framing_runs"] = sub["raw"].round().astype(int)
            sub = sub[["player_id", "framing_runs", "framing_runs_percentile"]].drop_duplicates("player_id")
            merged = pd.merge(merged, sub, on="player_id", how="outer") if not merged.empty else sub

    # Pop Time
    df_pop = safe_csv_get("/leaderboard/poptime", {"year": season, "team": "", "min2b": 1, "min3b": 0})
    if not df_pop.empty:
        c = first_column(df_pop, ("pop_2b_sba", "pop_2b", "pop_time", "maxeff_arm_2b_3b_sba"))
        if c:
            sub = pd.DataFrame({"player_id": player_ids(df_pop), "pop_time": pd.to_numeric(df_pop[c], errors="coerce")}).dropna()
            sub["player_id"] = sub["player_id"].astype(int)
            sub["pop_time"] = sub["pop_time"].round(2)
            sub["pop_time_percentile"] = percentile(sub["pop_time"], ascending=False)
            sub = sub[["player_id", "pop_time", "pop_time_percentile"]].drop_duplicates("player_id")
            merged = pd.merge(merged, sub, on="player_id", how="outer") if not merged.empty else sub

    return merged


def fetch_pitcher_extra(season: int, existing_pitcher_ids: set[int] | None = None,
                        cached_details: pd.DataFrame | None = None,
                        refresh_pitcher_details: bool = False) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/custom", {
        "year": season, "type": "pitcher", "min": 10,
        "selections": "player_id,xba,groundballs_percent,release_extension,ff_avg_speed"
    })
    if df.empty:
        return pd.DataFrame()

    out = pd.DataFrame({"player_id": player_ids(df)})
    xba_col = first_column(df, ("xba", "est_ba"))
    gb_col = first_column(df, ("groundballs_percent", "gb_percent", "gb_rate", "groundball_percent"))
    ext_col = first_column(df, ("release_extension", "extension", "ext"))
    fv_col = first_column(df, ("ff_avg_speed", "fastball_velocity"))

    if xba_col:
        out["xba"] = pd.to_numeric(df[xba_col], errors="coerce").round(3)
    if gb_col:
        out["gb_percentage"] = pd.to_numeric(df[gb_col], errors="coerce").round(1)
        out["gb_percentile"] = percentile(out["gb_percentage"], True)
    if ext_col:
        out["pitch_extension"] = pd.to_numeric(df[ext_col], errors="coerce").round(1)
        out["extension_percentile"] = percentile(out["pitch_extension"], True)
    if fv_col:
        out["fastball_velocity"] = pd.to_numeric(df[fv_col], errors="coerce").round(1)
        out["fastball_velo_percentile"] = percentile(out["fastball_velocity"], True)

    out = out.dropna(subset=["player_id"]).copy()
    out["player_id"] = out["player_id"].astype(int)
    out = out.drop_duplicates("player_id")
    if existing_pitcher_ids is not None:
        out = out[out["player_id"].isin(existing_pitcher_ids)].copy()
    # Keep saved extension and official percentiles instead of replacing them with
    # empty CSV values or locally calculated run-value percentiles.
    if cached_details is not None and not cached_details.empty:
        out = merge_frames([out, cached_details])
    if refresh_pitcher_details and existing_pitcher_ids is not None:
        missing = out
        print(f"[INFO] refreshing season-card details for {len(missing)} pitchers")
        with ThreadPoolExecutor(max_workers=6) as executor:
            rows = list(executor.map(lambda pid: fetch_pitcher_extension(int(pid), season),
                                     missing["player_id"]))
        supplements = pd.DataFrame([row for row in rows if row])
        if not supplements.empty:
            out = merge_frames([out, supplements])
    return out


def fetch_pitcher_k_bb(season: int) -> pd.DataFrame:
    try:
        resp = requests.get(MLB_STATS_API, params={
            "stats": "season", "season": season, "group": "pitching",
            "sportId": 1, "playerPool": "ALL", "limit": 2000
        }, headers=HEADERS, timeout=(5, 12))
        resp.raise_for_status()
        splits = resp.json().get("stats", [{}])[0].get("splits", [])
    except Exception as e:
        print(f"[SKIP] MLB pitcher K/BB: {e}")
        return pd.DataFrame()

    rows = []
    for split in splits:
        pid = split.get("player", {}).get("id")
        stat = split.get("stat", {})
        bf = pd.to_numeric(stat.get("battersFaced"), errors="coerce")
        so = pd.to_numeric(stat.get("strikeOuts"), errors="coerce")
        bb = pd.to_numeric(stat.get("baseOnBalls"), errors="coerce")
        if pid is None or pd.isna(bf) or bf <= 0:
            continue
        rows.append({
            "player_id": int(pid),
            "bb_percentage": round(float(bb / bf * 100), 1),
            "k_percentage": round(float(so / bf * 100), 1),
        })
    return pd.DataFrame(rows).drop_duplicates("player_id") if rows else pd.DataFrame()


def fetch_official_percentiles(season: int, player_type: str) -> pd.DataFrame:
    df = safe_csv_get("/leaderboard/percentile-rankings", {
        "type": player_type, "year": season, "position": "", "team": ""
    })
    if df.empty:
        return pd.DataFrame()

    ids = player_ids(df)
    out = pd.DataFrame({"player_id": ids})
    out = out[(out["player_id"].notna()) & (out["player_id"] != 999999)].copy()
    out["player_id"] = out["player_id"].astype(int)

    aliases = {
        "exit_velo_percentile": ("exit_velocity", "exit_velo_percentile", "ev"),
        "barrel_percentile": ("brl_percent", "barrel_percentile", "brl", "barrel"),
        "hard_hit_percentile": ("hard_hit_percent", "hard_hit_percentile", "hard_hit"),
        "xwoba_percentile": ("xwoba", "xwoba_percentile"),
        "sprint_speed_percentile": ("sprint_speed", "sprint_speed_percentile"),
        "oaa_percentile": ("oaa", "oaa_percentile", "outs_above_average"),
        "fielding_run_value_percentile": ("fielding_run_value", "frv", "runs_prevented"),
        "arm_value_percentile": ("arm_value", "runs_arm", "arm_runs"),
        "arm_strength_percentile": ("arm_strength", "arm_strength_percentile", "arm"),
        "bat_speed_percentile": ("bat_speed", "avg_bat_speed", "bat_speed_percentile"),
        "squared_up_percentile": ("squared_up_rate", "squared_up_per_swing", "squared_up_percentile", "squared_up"),
        "blocks_above_average_percentile": ("catcher_blocking", "blocks_above_average"),
        "cs_above_average_percentile": ("catcher_throwing", "cs_above_average"),
        "framing_runs_percentile": ("framing", "framing_runs"),
        "pop_time_percentile": ("pop_time", "pop_2b_sba"),
        "fastball_velo_percentile": ("fb_velocity", "ff_avg_speed", "fastball_velocity"),
        "extension_percentile": ("extension", "release_extension"),
    }
    for target, candidates in aliases.items():
        source = next((c for c in candidates if c in df.columns), None)
        if source is None:
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


def merge_frames(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """여러 지표 DataFrame을 player_id 기준으로 하나로 통합하여 단일 UPDATE만 수행하도록 함"""
    merged = pd.DataFrame(columns=["player_id"])
    for f in frames:
        if f is None or f.empty or "player_id" not in f.columns:
            continue
        f_clean = f.drop_duplicates("player_id").copy()
        if merged.empty:
            merged = f_clean
        else:
            # 이미 존재하는 컬럼은 새 값으로 보완(combine_first)
            overlap = [c for c in f_clean.columns if c in merged.columns and c != "player_id"]
            if overlap:
                merged = merged.set_index("player_id")
                f_idx = f_clean.set_index("player_id")
                for col in overlap:
                    merged[col] = f_idx[col].combine_first(merged[col])
                new_cols = [c for c in f_clean.columns if c not in overlap and c != "player_id"]
                if new_cols:
                    merged = merged.join(f_idx[new_cols], how="outer")
                merged = merged.reset_index()
            else:
                merged = pd.merge(merged, f_clean, on="player_id", how="outer")
    return merged


def bulk_update_role(engine, merged_df: pd.DataFrame, season: int, is_pitcher: bool, valid_db_cols: set[str]):
    if merged_df.empty:
        return

    target_cols = [c for c in merged_df.columns if c != "player_id" and c in valid_db_cols]
    if not target_cols:
        return

    with engine.connect() as conn:
        existing_ids = set(
            conn.execute(
                text("SELECT player_id FROM player_season_stats WHERE season = :s AND is_pitcher = :p AND games > 0"),
                {"s": season, "p": is_pitcher}
            ).scalars().all()
        )

    df_valid = merged_df[merged_df["player_id"].isin(existing_ids)].copy()
    if df_valid.empty:
        return

    assignments = ", ".join(f"{col} = COALESCE(:{col}, {col})" for col in target_cols)
    sql = text(
        f"UPDATE player_season_stats SET {assignments} "
        f"WHERE player_id = :player_id AND season = :season AND is_pitcher = :is_pitcher"
    )

    params = []
    for _, row in df_valid.iterrows():
        item = {
            "player_id": int(row["player_id"]),
            "season": int(season),
            "is_pitcher": bool(is_pitcher)
        }
        for col in target_cols:
            is_int = col.endswith("percentile") or (col in INTEGER_COLUMNS)
            item[col] = clean(row[col], integer=is_int)
        params.append(item)

    with engine.begin() as conn:
        res = conn.execute(sql, params)
    print(f"[DB BULK UPDATE] pitcher={is_pitcher}: {res.rowcount} rows updated across {len(target_cols)} columns.")


def run_savant_repair(season: int = 2024, dry_run: bool = False,
                      refresh_pitcher_details: bool = False, extension_only: bool = False):
    t0 = time.time()
    if dry_run:
        print("[DRY RUN] DB writes disabled")
    project_root = Path(__file__).resolve().parents[1]
    if not (project_root / "database").exists():
        project_root = Path(__file__).resolve().parents[2]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    from database.db_connection import engine

    # DB에 실제로 존재하는 컬럼 목록만 확인 (ALTER TABLE을 실행하지 않아 락 발생 0%)
    with engine.connect() as conn:
        valid_db_cols = set(
            conn.execute(text("""
                SELECT COLUMN_NAME
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'player_season_stats'
            """)).scalars().all()
        )

    detail_columns = [column for column in (
        "pitch_extension", "extension_percentile",
    ) if column in valid_db_cols]
    with engine.connect() as conn:
        rows = conn.execute(text(
            f"SELECT player_id{''.join(', ' + col for col in detail_columns)} "
            "FROM player_season_stats "
            "WHERE season = :s AND is_pitcher = 1 AND games > 0"
        ), {"s": season}).mappings().all()
    cached_details = pd.DataFrame(rows, columns=["player_id", *detail_columns])
    existing_pitcher_ids = set(cached_details["player_id"])
    if extension_only:
        with ThreadPoolExecutor(max_workers=6) as executor:
            rows = list(executor.map(lambda pid: fetch_pitcher_extension(int(pid), season),
                                     sorted(existing_pitcher_ids)))
        extension = pd.DataFrame([row for row in rows if row])
        if not extension.empty:
            extension = extension[["player_id", "pitch_extension", "extension_percentile"]]
        if not dry_run:
            bulk_update_role(engine, extension, season, True, valid_db_cols)
        print(f"[EXTENSION] collected {len(extension)} pitchers in {time.time() - t0:.2f}s")
        return

    if not refresh_pitcher_details:
        print("[FAST] using saved pitcher details; individual player requests disabled")

    print(f"=== [{season} 시즌] Savant 병렬 수집 시작 ===")
    tasks = {
        "oaa": lambda: fetch_oaa(season),
        "frv_arm": lambda: fetch_fielding_and_arm_value(season),  # ★ Fielding Run Value & Arm Value 추가!
        "bat_rv": lambda: fetch_swing_take(season, "Batter", "batting_run_value"),
        "bsr": lambda: fetch_baserunning(season),
        "arm": lambda: fetch_arm_strength(season),
        "bat_track": lambda: fetch_bat_tracking(season),
        "catching": lambda: fetch_catcher_all(season),
        "bat_pct": lambda: fetch_official_percentiles(season, "batter"),
        "pit_rv": lambda: fetch_swing_take(season, "Pitcher", "pitching_run_value"),
        "pitch_rv": lambda: fetch_pitch_run_values(season),
        "pit_extra": lambda: fetch_pitcher_extra(
            season, existing_pitcher_ids, cached_details, refresh_pitcher_details),
        "pit_k_bb": lambda: fetch_pitcher_k_bb(season),
        "pit_pct": lambda: fetch_official_percentiles(season, "pitcher"),
    }

    results = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        future_map = {executor.submit(fn): name for name, fn in tasks.items()}
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                results[name] = future.result()
            except Exception as e:
                print(f"[ERR] Task {name}: {e}")
                results[name] = pd.DataFrame()

    # 1) 타자/포수 통합 후 단 1회 Bulk Update (공식 백분위가 가장 마지막에 우선 덮어쓰도록 순서 배치)
    batter_merged = merge_frames([
        results.get("oaa"),
        results.get("frv_arm"),  # ★ 병합 리스트에 추가!
        results.get("bat_rv"),
        results.get("bsr"),
        results.get("arm"),
        results.get("bat_track"),
        results.get("catching"),
        results.get("bat_pct"),
    ])
    if not dry_run:
        bulk_update_role(engine, batter_merged, season, False, valid_db_cols)

    # 2) 투수 통합 후 단 1회 Bulk Update
    pitcher_merged = merge_frames([
        results.get("pit_rv"),
        results.get("pitch_rv"),
        results.get("pit_extra"),
        results.get("pit_k_bb"),
        results.get("pit_pct"),
    ])
    if not dry_run:
        bulk_update_role(engine, pitcher_merged, season, True, valid_db_cols)

    print(f"=== [{season} 시즌] Savant 수집 완료! (소요 시간: {round(time.time() - t0, 2)}초) ===")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2024)
    parser.add_argument("--project-root", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--refresh-pitcher-details", action="store_true",
                        help="Fetch each pitcher page to initialize/refresh extension and official percentiles (slow)")
    parser.add_argument("--extension-only", action="store_true",
                        help="Collect only pitcher Extension and its official percentile (slow)")
    args = parser.parse_args()
    run_savant_repair(season=args.season, dry_run=args.dry_run,
                      refresh_pitcher_details=args.refresh_pitcher_details, extension_only=args.extension_only)


if __name__ == "__main__":
    main()
