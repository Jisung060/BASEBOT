"""Track derived metric provenance in the same transaction as season writes."""
import math
import re
import pandas as pd
from sqlalchemy import text


def is_derived(metric):
    return metric in {"bwar", "fwar", "fip", "wrc_plus", "k_percentage", "bb_percentage"} or metric.endswith("percentile")


def ensure_provenance_table(engine):
    # Run schema initialization before the data transaction (MySQL DDL commits).
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS player_stat_provenance (
                player_id INT NOT NULL,
                season INT NOT NULL,
                is_pitcher BOOLEAN NOT NULL,
                metric VARCHAR(64) NOT NULL,
                source VARCHAR(255) NOT NULL,
                stored_value DOUBLE NOT NULL,
                recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (player_id, season, is_pitcher, metric)
            )
        """))


def finite(value):
    try:
        return value is not None and math.isfinite(float(value))
    except (ValueError, TypeError):
        return False


def choose_stat(old_value, old_source, new_value, new_source):
    if not finite(new_value):
        return old_value, old_source or "legacy_unknown", False
    if finite(old_value) and new_source == "estimated" and old_source not in (None, "legacy_unknown"):
        return old_value, old_source or "legacy_unknown", False
    if finite(old_value) and math.isclose(float(old_value), float(new_value), rel_tol=1e-9, abs_tol=1e-6):
        return old_value, new_source, True
    return new_value, new_source, True


def protect_derived_stats(conn, frame, season, is_pitcher, columns):
    metrics = [c for c in columns if is_derived(c) and c in frame]
    if not metrics or frame.empty:
        return frame, []
    if any(not re.fullmatch(r"[a-z_]+", c) for c in metrics):
        raise ValueError("Invalid metric identifier")
    params = {"season": season, "is_pitcher": is_pitcher}
    existing = conn.execute(text(
        "SELECT player_id, " + ", ".join(metrics) +
        " FROM player_season_stats WHERE season = :season AND is_pitcher = :is_pitcher FOR UPDATE"
    ), params).mappings().all()
    previous = {int(row["player_id"]): dict(row) for row in existing}
    metadata = conn.execute(text(
        "SELECT player_id, metric, source, stored_value FROM player_stat_provenance "
        "WHERE season = :season AND is_pitcher = :is_pitcher"
    ), params).mappings().all()
    origins = {(int(row["player_id"]), row["metric"]): row for row in metadata}
    result = frame.copy()
    records = []
    preserved = 0
    for index, row in result.iterrows():
        player_id = int(row["player_id"])
        for metric in metrics:
            old = previous.get(player_id, {}).get(metric)
            metadata_row = origins.get((player_id, metric))
            old_source = None
            # An external writer may have changed the value without provenance.
            if metadata_row and finite(old) and math.isclose(float(old), float(metadata_row["stored_value"]), abs_tol=1e-6):
                old_source = metadata_row["source"]
            source = row.get(f"{metric}__source")
            source = source if isinstance(source, str) and source else "estimated"
            value, selected_source, accepted = choose_stat(old, old_source, row[metric], source)
            if finite(old) and not accepted:
                preserved += 1
            result.at[index, metric] = float(value) if finite(value) else None
            if finite(value) and (accepted or metadata_row is None or old_source != selected_source):
                records.append({"player_id": player_id, "season": season,
                                "is_pitcher": is_pitcher, "metric": metric,
                                "source": selected_source, "value": float(value)})
    print(f"[PROVENANCE] preserved {preserved} stored values; recording {len(records)} sources")
    return result, records


def save_provenance(conn, records):
    if records:
        conn.execute(text("""
            INSERT INTO player_stat_provenance
                (player_id, season, is_pitcher, metric, source, stored_value)
            VALUES (:player_id, :season, :is_pitcher, :metric, :source, :value)
            ON DUPLICATE KEY UPDATE source = VALUES(source),
                stored_value = VALUES(stored_value), recorded_at = CURRENT_TIMESTAMP
        """), records)
