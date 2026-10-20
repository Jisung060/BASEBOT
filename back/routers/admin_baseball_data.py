import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import engine, get_db

router = APIRouter(prefix="/api/admin/baseball-data", tags=["Admin Baseball Data"])

BACK_DIR = Path(__file__).resolve().parent.parent

# ★ admin_news.py와 동일하게 back/config/basebot_admin_settings.json 공유
DEFAULT_SETTINGS_PATH = BACK_DIR / "config" / "basebot_admin_settings.json"
SETTINGS_FILE = Path(
    os.getenv(
        "BASEBOT_SETTINGS_FILE",
        os.getenv("MLB_NEWS_SETTINGS_FILE", str(DEFAULT_SETTINGS_PATH))
    )
).resolve()

# ★ 동시 실행 방지 락 & 워커 이벤트/상태 플래그 (news.py 패턴과 통일)
baseball_sync_lock = threading.Lock()
_scheduler_wake_event = threading.Event()
_scheduler_started = False

DEFAULT_SCHEDULES = [
    {
        "schedule_id": 1,
        "data_type": "PIPELINE_PLAYERS",
        "label": "선수 통합 파이프라인 (타자/투수 ➔ 메타 ➔ Savant)",
        "is_enabled": False,
        "interval_type": "DAILY",
        "run_time": "04:00",
        "target_option": "2024",
        "last_run_at": None,
    },
    {
        "schedule_id": 2,
        "data_type": "PIPELINE_GAMES",
        "label": "경기 통합 파이프라인 (경기 ➔ 박스스코어 ➔ 시간/구장 보정)",
        "is_enabled": True,
        "interval_type": "EVERY_6H",
        "run_time": "00:00",
        "target_option": "RECENT_3DAYS",
        "last_run_at": None,
    },
    {
        "schedule_id": 3,
        "data_type": "STEP_SAVANT_REPAIR",
        "label": "Savant 심화 지표 빠른 갱신 (Extension 제외)",
        "is_enabled": False,
        "interval_type": "DAILY",
        "run_time": "05:00",
        "target_option": "2024",
        "last_run_at": None,
    },
    {
        "schedule_id": 4,
        "data_type": "STEP_SAVANT_EXTENSION",
        "label": "투수 Extension 단독 갱신 (장시간 소요)",
        "is_enabled": False,
        "interval_type": "WEEKLY",
        "run_time": "06:00",
        "target_option": "2024",
        "last_run_at": None,
    },
    {
        "schedule_id": 5,
        "data_type": "STEP_SEED_TEAMS",
        "label": "30개 구단 기초 정보 동기화 (seed_teams)",
        "is_enabled": False,
        "interval_type": "WEEKLY",
        "run_time": "03:00",
        "target_option": "ALL",
        "last_run_at": None,
    },
]


# =========================================================
# 유틸리티: 전역 설정 JSON 파일 Read / Write 및 DB 동기화
# =========================================================
def _read_global_settings() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


def _write_global_settings(payload: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = SETTINGS_FILE.with_suffix(".tmp")
    temp_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_file.replace(SETTINGS_FILE)


def _load_schedules_from_settings() -> list[dict]:
    """전역 설정 파일(mlb_news_settings.json)에서 야구 데이터 스케줄을 읽고, 없으면 DB/기본값으로 초기화"""
    payload = _read_global_settings()
    saved_list = payload.get("baseball_data_schedules")

    if isinstance(saved_list, list) and len(saved_list) > 0:
        saved_map = {item.get("data_type"): item for item in saved_list if isinstance(item, dict)}
        merged = []
        for idx, default_item in enumerate(DEFAULT_SCHEDULES, start=1):
            dtype = default_item["data_type"]
            if dtype in saved_map:
                cur = dict(default_item)
                cur.update(saved_map[dtype])
                cur["schedule_id"] = cur.get("schedule_id") or idx
                cur["label"] = default_item["label"]
                merged.append(cur)
            else:
                merged.append(dict(default_item))
        return merged

    # 파일에 아직 없으면 DB에 저장된 기존 설정이 있는지 확인 후 마이그레이션
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT schedule_id, data_type, label, is_enabled, interval_type, run_time, target_option,
                       CAST(last_run_at AS CHAR) AS last_run_at,
                       CAST(updated_at AS CHAR) AS updated_at
                FROM admin_data_schedules
                ORDER BY schedule_id ASC
            """)).mappings().all()
            if rows:
                db_schedules = [dict(r) for r in rows]
                for item in db_schedules:
                    item["is_enabled"] = bool(item.get("is_enabled"))
                _save_schedules_to_settings(db_schedules)
                return db_schedules
    except Exception:
        pass

    _save_schedules_to_settings(DEFAULT_SCHEDULES)
    return [dict(x) for x in DEFAULT_SCHEDULES]


def _save_schedules_to_settings(schedules: list[dict]) -> None:
    """전역 JSON 파일에 스케줄 목록을 원자적으로 저장 (뉴스의 interval_seconds 보존)"""
    payload = _read_global_settings()
    if "interval_seconds" not in payload:
        payload["interval_seconds"] = max(60, min(int(os.getenv("MLB_NEWS_INTERVAL", "3600")), 86400))
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for item in schedules:
        item["updated_at"] = item.get("updated_at") or now_str
    payload["baseball_data_schedules"] = schedules
    _write_global_settings(payload)


def _mark_schedule_last_run(data_type: str, run_dt: datetime) -> None:
    """자동 실행 완료 시각을 전역 설정 파일과 DB 양쪽에 기록"""
    run_str = run_dt.strftime("%Y-%m-%d %H:%M:%S")
    schedules = _load_schedules_from_settings()
    for item in schedules:
        if item.get("data_type") == data_type:
            item["last_run_at"] = run_str
            item["updated_at"] = run_str
    _save_schedules_to_settings(schedules)

    try:
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE admin_data_schedules
                SET last_run_at = :rtime
                WHERE data_type = :dtype
            """), {"rtime": run_str, "dtype": data_type})
    except Exception as exc:
        print(f"[BaseballScheduler] DB last_run_at 갱신 실패: {exc}")


# =========================================================
# 유틸리티: back 폴더 내 스크립트 파일 자동 탐색 및 모듈 로드
# =========================================================
def find_script_path(filename: str) -> Path:
    candidates = [
        BACK_DIR / "scripts" / filename,
        BACK_DIR / "collectors" / filename,
        BACK_DIR / "data" / filename,
        BACK_DIR / filename,
    ]
    for p in candidates:
        if p.exists():
            return p
    for p in BACK_DIR.rglob(filename):
        return p
    raise FileNotFoundError(f"스크립트 파일을 찾을 수 없습니다: {filename}")


def load_script_module(filename: str):
    path = find_script_path(filename)
    spec = importlib.util.spec_from_file_location(path.stem, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, path


# =========================================================
# 0. 수집 기록 & 스케줄 관리 테이블 초기화
# =========================================================
def init_admin_baseball_tables():
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_data_sync_logs (
                log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                data_type VARCHAR(50) NOT NULL,
                trigger_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
                target_param VARCHAR(100) NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
                records_affected INT NOT NULL DEFAULT 0,
                duration_sec DECIMAL(8, 2) NULL,
                message TEXT NULL,
                started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                finished_at DATETIME NULL
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_data_schedules (
                schedule_id INT AUTO_INCREMENT PRIMARY KEY,
                data_type VARCHAR(50) NOT NULL UNIQUE,
                label VARCHAR(100) NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                interval_type VARCHAR(30) NOT NULL DEFAULT 'DAILY',
                run_time VARCHAR(10) NOT NULL DEFAULT '04:00',
                target_option VARCHAR(50) NOT NULL DEFAULT '2024',
                last_run_at DATETIME NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        """))

        for item in DEFAULT_SCHEDULES:
            conn.execute(text("""
                INSERT IGNORE INTO admin_data_schedules 
                (data_type, label, is_enabled, interval_type, run_time, target_option)
                VALUES (:dtype, :label, :enabled, :iv_type, :rtime, :topt)
            """), {
                "dtype": item["data_type"],
                "label": item["label"],
                "enabled": item["is_enabled"],
                "iv_type": item["interval_type"],
                "rtime": item["run_time"],
                "topt": item["target_option"],
            })
            if item["data_type"] in ("STEP_SAVANT_REPAIR", "STEP_SAVANT_EXTENSION"):
                conn.execute(text(
                    "UPDATE admin_data_schedules SET label = :label WHERE data_type = :dtype AND label <> :label"
                ), {"label": item["label"], "dtype": item["data_type"]})

    # 전역 설정 JSON 파일 초기 동기화 보장
    _load_schedules_from_settings()


init_admin_baseball_tables()


# =========================================================
# 1. 상단 대시보드 4대 지표 조회
# =========================================================
@router.get("/summary")
def get_baseball_data_summary(db: Session = Depends(get_db)):
    teams_cnt = db.execute(text("SELECT COUNT(*) FROM teams")).scalar() or 0
    players_cnt = db.execute(text("SELECT COUNT(*) FROM players")).scalar() or 0
    games_cnt = db.execute(text("SELECT COUNT(*) FROM games")).scalar() or 0

    missing_games = db.execute(text("""
        SELECT COUNT(*) FROM games
        WHERE (status = 'FINAL' AND (winning_team_id IS NULL OR linescore IS NULL) AND home_score != away_score)
           OR stadium IS NULL
           OR game_time IS NULL
    """)).scalar() or 0

    missing_players_meta = db.execute(text("""
        SELECT COUNT(*) FROM players WHERE position IS NULL OR birth_date IS NULL
    """)).scalar() or 0

    review_needed = int(missing_games) + int(missing_players_meta)

    seasons = db.execute(text("""
        SELECT DISTINCT season FROM player_season_stats WHERE season IS NOT NULL ORDER BY season DESC
    """)).scalars().all()

    return {
        "teams_count": int(teams_cnt),
        "players_count": int(players_cnt),
        "games_count": int(games_cnt),
        "review_needed_count": review_needed,
        "missing_games": int(missing_games),
        "missing_players_meta": int(missing_players_meta),
        "available_seasons": [int(s) for s in seasons] or [2024]
    }


# =========================================================
# 2. 항목별 데이터 통합 조회 (타자 / 투수 / 경기 / 팀)
# =========================================================
@router.get("/items")
def get_baseball_data_items(
    category: str = Query("batters", description="batters, pitchers, games, teams"),
    keyword: str = Query(""),
    season: Optional[int] = Query(None),
    game_status: str = Query(""),
    limit: int = Query(150, ge=1, le=500),
    db: Session = Depends(get_db)
):
    kw = f"%{keyword.strip()}%" if keyword.strip() else None

    if category == "batters":
        where_clauses = ["s.is_pitcher = FALSE"]
        params = {"limit": limit}
        if season:
            where_clauses.append("s.season = :season")
            params["season"] = season
        if kw:
            where_clauses.append("(p.player_name LIKE :kw OR t.team_name LIKE :kw OR t.team_code LIKE :kw)")
            params["kw"] = kw

        sql = text(f"""
            SELECT 
                p.player_id,
                p.player_name,
                p.position,
                s.season,
                COALESCE(t.team_code, 'FA') AS team_code,
                s.games,
                s.batting_avg,
                s.home_runs,
                s.rbi,
                s.stolen_bases,
                s.wrc_plus,
                s.xwoba,
                s.avg_exit_velocity,
                s.barrel_percentage,
                s.outs_above_average,
                s.batting_run_value,
                s.bwar,
                s.fwar
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            LEFT JOIN teams t ON COALESCE(s.team_id, p.team_id) = t.team_id
            WHERE {" AND ".join(where_clauses)}
            ORDER BY s.season DESC, s.bwar DESC
            LIMIT :limit
        """)
        rows = db.execute(sql, params).mappings().all()
        return {"category": category, "items": [dict(r) for r in rows]}

    elif category == "pitchers":
        where_clauses = ["s.is_pitcher = TRUE"]
        params = {"limit": limit}
        if season:
            where_clauses.append("s.season = :season")
            params["season"] = season
        if kw:
            where_clauses.append("(p.player_name LIKE :kw OR t.team_name LIKE :kw OR t.team_code LIKE :kw)")
            params["kw"] = kw

        sql = text(f"""
            SELECT 
                p.player_id,
                p.player_name,
                p.throws,
                s.season,
                COALESCE(t.team_code, 'FA') AS team_code,
                s.games,
                s.wins,
                s.losses,
                s.era,
                s.fip,
                s.xera,
                s.whip,
                s.innings_pitched,
                s.strikeouts,
                s.fastball_velocity,
                s.pitching_run_value,
                s.bwar,
                s.fwar
            FROM player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            LEFT JOIN teams t ON COALESCE(s.team_id, p.team_id) = t.team_id
            WHERE {" AND ".join(where_clauses)}
            ORDER BY s.season DESC, s.innings_pitched DESC
            LIMIT :limit
        """)
        rows = db.execute(sql, params).mappings().all()
        return {"category": category, "items": [dict(r) for r in rows]}

    elif category == "games":
        where_clauses = ["1=1"]
        params = {"limit": limit}
        if season:
            where_clauses.append("YEAR(g.game_date) = :season")
            params["season"] = season
        if game_status:
            where_clauses.append("g.status = :status")
            params["status"] = game_status
        if kw:
            where_clauses.append("""
                (CAST(g.game_id AS CHAR) LIKE :kw 
                 OR ht.team_name LIKE :kw 
                 OR at.team_name LIKE :kw 
                 OR g.stadium LIKE :kw)
            """)
            params["kw"] = kw

        sql = text(f"""
            SELECT 
                g.game_id,
                CAST(g.game_date AS CHAR) AS game_date,
                CAST(g.game_time AS CHAR) AS game_time,
                at.team_name AS away_team_name,
                at.team_code AS away_team_code,
                ht.team_name AS home_team_name,
                ht.team_code AS home_team_code,
                g.away_score,
                g.home_score,
                g.status,
                g.stadium,
                wt.team_code AS winning_team_code,
                CASE WHEN g.linescore IS NOT NULL THEN '보유' ELSE '미수집' END AS has_linescore
            FROM games g
            LEFT JOIN teams ht ON g.home_team_id = ht.team_id
            LEFT JOIN teams at ON g.away_team_id = at.team_id
            LEFT JOIN teams wt ON g.winning_team_id = wt.team_id
            WHERE {" AND ".join(where_clauses)}
            ORDER BY g.game_date DESC, g.game_id DESC
            LIMIT :limit
        """)
        rows = db.execute(sql, params).mappings().all()
        return {"category": category, "items": [dict(r) for r in rows]}

    elif category == "teams":
        where_clauses = ["1=1"]
        params = {"season": season or 2024}
        if kw:
            where_clauses.append("(t.team_name LIKE :kw OR t.team_code LIKE :kw OR t.city LIKE :kw OR t.stadium LIKE :kw)")
            params["kw"] = kw

        sql = text(f"""
            SELECT 
                t.team_id,
                t.team_name,
                t.team_code,
                t.league,
                t.division,
                t.city,
                t.stadium,
                COUNT(DISTINCT CASE WHEN s.is_pitcher = FALSE THEN s.player_id END) AS batter_count,
                COUNT(DISTINCT CASE WHEN s.is_pitcher = TRUE THEN s.player_id END) AS pitcher_count
            FROM teams t
            LEFT JOIN player_season_stats s 
                ON COALESCE(s.team_id, 0) = t.team_id AND s.season = :season
            WHERE {" AND ".join(where_clauses)}
            GROUP BY t.team_id, t.team_name, t.team_code, t.league, t.division, t.city, t.stadium
            ORDER BY t.league ASC, t.division ASC, t.team_name ASC
        """)
        rows = db.execute(sql, params).mappings().all()
        return {"category": category, "items": [dict(r) for r in rows]}

    else:
        raise HTTPException(status_code=400, detail="유효하지 않은 카테고리입니다.")


# =========================================================
# 3. 스크립트 파이프라인 실행기 (순서 엄격 보장 + 중복 실행 방지 락)
# =========================================================
class ManualFetchRequest(BaseModel):
    data_type: str
    season: Optional[int] = 2024
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    trigger_type: str = "MANUAL"
    refresh_pitcher_details: bool = False


def _update_log_progress(log_id: int, message: str):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE admin_data_sync_logs SET message = :msg WHERE log_id = :lid"),
            {"msg": message, "lid": log_id}
        )


def _sync_season_team_ids(season: int):
    """수집 직후 player_season_stats.team_id 누락분 동기화 및 players.team_id를 최신 시즌 구단으로 갱신"""
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE player_season_stats s
            JOIN players p ON s.player_id = p.player_id
            SET s.team_id = p.team_id
            WHERE s.season = :season AND s.team_id IS NULL
        """), {"season": season})

        conn.execute(text("""
            UPDATE players p
            JOIN (
                SELECT s1.player_id, s1.team_id
                FROM player_season_stats s1
                JOIN (
                    SELECT player_id, MAX(season) AS max_season
                    FROM player_season_stats
                    WHERE team_id IS NOT NULL AND games > 0
                    GROUP BY player_id
                ) s2 ON s1.player_id = s2.player_id AND s1.season = s2.max_season
                WHERE s1.team_id IS NOT NULL
            ) latest ON p.player_id = latest.player_id
            SET p.team_id = latest.team_id
        """))


def _run_batters(season: int) -> int:
    mod, _ = load_script_module("collector_batters_integrated.py")
    mod.collect_batters_comprehensive(season=season)
    _sync_season_team_ids(season)
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM player_season_stats WHERE season = :s AND is_pitcher = FALSE"),
            {"s": season}
        ).scalar() or 0


def _run_pitchers(season: int) -> int:
    mod, _ = load_script_module("collector_pitchers_integrated.py")
    mod.collect_pitchers_comprehensive(season=season)
    _sync_season_team_ids(season)
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM player_season_stats WHERE season = :s AND is_pitcher = TRUE"),
            {"s": season}
        ).scalar() or 0


def _run_players_meta() -> int:
    mod, _ = load_script_module("collector_players_meta.py")
    mod.update_players_metadata_via_pybaseball()
    with engine.connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM players")).scalar() or 0


def _run_savant_repair(season: int, refresh_pitcher_details: bool = False) -> int:
    mod, _ = load_script_module("collector_savant_value_repair.py")
    if hasattr(mod, "run_savant_repair"):
        mod.run_savant_repair(season=season, refresh_pitcher_details=refresh_pitcher_details)
    else:
        script_path = find_script_path("collector_savant_value_repair.py")
        command = [sys.executable, str(script_path), "--season", str(season),
                   "--project-root", str(BACK_DIR)]
        if refresh_pitcher_details:
            command.append("--refresh-pitcher-details")
        subprocess.run(command, cwd=str(BACK_DIR),
                       timeout=1800 if refresh_pitcher_details else 180, check=True)
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM player_season_stats WHERE season = :s"),
            {"s": season}
        ).scalar() or 0


def _run_savant_extension(season: int) -> int:
    mod, _ = load_script_module("collector_savant_value_repair.py")
    mod.run_savant_repair(season=season, extension_only=True)
    with engine.connect() as conn:
        return conn.execute(text(
            "SELECT COUNT(*) FROM player_season_stats "
            "WHERE season = :s AND is_pitcher = TRUE AND games > 0 AND pitch_extension IS NOT NULL"
        ), {"s": season}).scalar() or 0


def _run_games(season: int, start_date: str, end_date: str) -> int:
    mod, _ = load_script_module("collector_games.py")
    df_games = mod.fetch_mlb_games(season=season, start_date=start_date, end_date=end_date)
    mod.load_games_to_db(df_games)
    return len(df_games)


def _run_boxscores(start_date: str, end_date: str) -> int:
    mod, _ = load_script_module("collector_boxscores.py")
    mod.run_boxscore_collector(start_date=start_date, end_date=end_date)
    with engine.connect() as conn:
        return conn.execute(text("""
            SELECT COUNT(*) FROM games 
            WHERE DATE(game_date) BETWEEN :s AND :e AND linescore IS NOT NULL
        """), {"s": start_date, "e": end_date}).scalar() or 0


def _run_repair_games() -> int:
    mod, _ = load_script_module("repair_games_data.py")
    mod.repair_games()
    with engine.connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM games WHERE winning_team_id IS NOT NULL")).scalar() or 0


def _run_seed_teams() -> int:
    mod, _ = load_script_module("seed_teams.py")
    mod.seed_teams()
    return 30


def _create_sync_log(req: ManualFetchRequest) -> int:
    is_game_job = req.data_type in ("PIPELINE_GAMES", "STEP_GAMES", "STEP_BOXSCORES")
    if is_game_job:
        target_desc = f"{req.start_date} ~ {req.end_date}"
    elif req.data_type in ("STEP_PLAYERS_META", "STEP_REPAIR_GAMES", "STEP_SEED_TEAMS"):
        target_desc = "전체 DB 대상"
    else:
        target_desc = f"{req.season} 시즌"

    if req.data_type in ("PIPELINE_PLAYERS", "STEP_SAVANT_REPAIR"):
        target_desc += " / 투수 상세 갱신" if req.refresh_pitcher_details else " / 빠른 갱신"

    with engine.begin() as conn:
        res = conn.execute(text("""
            INSERT INTO admin_data_sync_logs (data_type, trigger_type, target_param, status, message)
            VALUES (:dtype, :ttype, :tparam, 'RUNNING', '파이프라인 스크립트 실행 준비 중...')
        """), {
            "dtype": req.data_type,
            "ttype": req.trigger_type,
            "tparam": target_desc
        })
        return res.lastrowid


def _execute_pipeline_job(log_id: int, req: ManualFetchRequest):
    if not baseball_sync_lock.acquire(blocking=False):
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE admin_data_sync_logs
                SET status = 'FAILED',
                    duration_sec = 0,
                    message = '다른 야구 데이터 수집 작업이 이미 진행 중이어서 건너뛰었습니다.',
                    finished_at = CURRENT_TIMESTAMP
                WHERE log_id = :lid
            """), {"lid": log_id})
        return

    start_ts = time.time()
    records_cnt = 0
    msg = ""
    status = "SUCCESS"

    season = int(req.season or 2024)
    savant_mode = "투수 상세 갱신 · 장시간 소요" if req.refresh_pitcher_details else "빠른 갱신 · 저장된 투수 상세 유지"
    s_date = req.start_date or f"{season}-04-01"
    e_date = req.end_date or f"{season}-04-30"
    if s_date and len(s_date) >= 4 and s_date[:4].isdigit():
        season_from_date = int(s_date[:4])
    else:
        season_from_date = season

    try:
        dtype = req.data_type

        if dtype == "PIPELINE_PLAYERS":
            _update_log_progress(log_id, f"[1/3] {season} 시즌 타자·투수 통합 데이터 수집 중 (collector_batters/pitchers)...")
            b_cnt = _run_batters(season)
            p_cnt = _run_pitchers(season)

            _update_log_progress(log_id, f"[2/3] 선수 프로필·메타데이터 갱신 중 (collector_players_meta)...")
            m_cnt = _run_players_meta()

            _update_log_progress(log_id, f"[3/3] Savant 심화 지표·백분위 수집 중 ({savant_mode})...")
            _run_savant_repair(season, refresh_pitcher_details=req.refresh_pitcher_details)

            records_cnt = b_cnt + p_cnt
            msg = f"[선수 파이프라인 완주] 1단계(타자 {b_cnt}·투수 {p_cnt}명) ➔ 2단계(메타 {m_cnt}명) ➔ 3단계(Savant: {savant_mode}) 완료"

        elif dtype == "PIPELINE_GAMES":
            _update_log_progress(log_id, f"[1/3] {s_date}~{e_date} 경기 일정·결과 수집 중 (collector_games)...")
            g_cnt = _run_games(season_from_date, s_date, e_date)

            _update_log_progress(log_id, f"[2/3] {s_date}~{e_date} 박스스코어·라인스코어 수집 중 (collector_boxscores)...")
            bx_cnt = _run_boxscores(s_date, e_date)

            _update_log_progress(log_id, f"[3/3] 경기 시간·구장명·승리팀 보정 중 (repair_games_data)...")
            _run_repair_games()

            records_cnt = g_cnt
            msg = f"[경기 파이프라인 완주] 1단계(경기 {g_cnt}건) ➔ 2단계(박스스코어 {bx_cnt}건) ➔ 3단계(시간/구장/승리팀 보정) 완료"

        elif dtype == "STEP_BATTERS":
            _update_log_progress(log_id, f"{season} 시즌 타자 데이터 수집 중 (collector_batters_integrated)...")
            records_cnt = _run_batters(season)
            msg = f"{season} 시즌 타자 세이버메트릭스 {records_cnt}명 적재 완료"

        elif dtype == "STEP_PITCHERS":
            _update_log_progress(log_id, f"{season} 시즌 투수 데이터 수집 중 (collector_pitchers_integrated)...")
            records_cnt = _run_pitchers(season)
            msg = f"{season} 시즌 투수 세이버메트릭스 {records_cnt}명 적재 완료"

        elif dtype == "STEP_PLAYERS_META":
            _update_log_progress(log_id, "선수 메타데이터 전수 갱신 중 (collector_players_meta)...")
            records_cnt = _run_players_meta()
            msg = f"선수 프로필 메타데이터(등번호·포지션·투타·신체조건·ID매핑) {records_cnt}명 갱신 완료"

        elif dtype == "STEP_SAVANT_REPAIR":
            _update_log_progress(log_id, f"{season} 시즌 Savant OAA·RunValue·구속 보강 중 ({savant_mode})...")
            records_cnt = _run_savant_repair(season, refresh_pitcher_details=req.refresh_pitcher_details)
            msg = f"{season} 시즌 Savant 심화 지표 {records_cnt}건 보강 완료 ({savant_mode})"

        elif dtype == "STEP_SAVANT_EXTENSION":
            _update_log_progress(log_id, f"{season} 시즌 투수 Extension 개별 조회 중 (수 분 이상 소요 가능)...")
            records_cnt = _run_savant_extension(season)
            msg = f"{season} 시즌 Extension 단독 갱신 완료 (Extension 보유 {records_cnt}건)"

        elif dtype == "STEP_GAMES":
            _update_log_progress(log_id, f"{s_date}~{e_date} 경기 일정 수집 중 (collector_games)...")
            records_cnt = _run_games(season_from_date, s_date, e_date)
            msg = f"{s_date} ~ {e_date} 경기 기본 일정 및 스코어 {records_cnt}건 적재 완료"

        elif dtype == "STEP_BOXSCORES":
            _update_log_progress(log_id, f"{s_date}~{e_date} 박스스코어·라인스코어 수집 중 (collector_boxscores)...")
            records_cnt = _run_boxscores(s_date, e_date)
            msg = f"{s_date} ~ {e_date} 박스스코어 및 이닝별 라인스코어 {records_cnt}건 적재 완료"

        elif dtype == "STEP_REPAIR_GAMES":
            _update_log_progress(log_id, "경기 시간·구장명·승리팀 보정 중 (repair_games_data)...")
            records_cnt = _run_repair_games()
            msg = f"경기 시간·경기장·승리팀(winning_team_id) {records_cnt}건 보정 완료"

        elif dtype == "STEP_SEED_TEAMS":
            _update_log_progress(log_id, "MLB 30개 구단 시드 데이터 동기화 중 (seed_teams)...")
            records_cnt = _run_seed_teams()
            msg = "MLB 30개 구단 정보(seed_teams.py) 동기화 완료"

        else:
            raise ValueError(f"알 수 없는 수집 항목: {dtype}")

    except Exception as e:
        status = "FAILED"
        msg = f"실행 실패: {str(e)}"
        traceback.print_exc()

    finally:
        duration = round(time.time() - start_ts, 2)
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE admin_data_sync_logs
                SET status = :status,
                    records_affected = :rcnt,
                    duration_sec = :dur,
                    message = :msg,
                    finished_at = CURRENT_TIMESTAMP
                WHERE log_id = :lid
            """), {
                "status": status,
                "rcnt": records_cnt,
                "dur": duration,
                "msg": msg,
                "lid": log_id
            })
        baseball_sync_lock.release()


@router.post("/fetch")
def trigger_manual_fetch(
    req: ManualFetchRequest,
    background_tasks: BackgroundTasks,
):
    if baseball_sync_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="이미 야구 데이터 수집 작업이 진행 중입니다. 완료 후 다시 시도해 주세요."
        )

    log_id = _create_sync_log(req)
    background_tasks.add_task(_execute_pipeline_job, log_id, req)
    return {
        "status": "started",
        "log_id": log_id,
        "message": f"[{req.data_type}] 스크립트 실행이 시작되었습니다. 하단 수집 기록에서 실시간 진행 단계를 확인하세요."
    }


# =========================================================
# 4. 자동화 스케줄 조회 및 저장 (mlb_news_settings.json + DB 통합)
# =========================================================
@router.get("/schedules")
def get_schedules():
    schedules = _load_schedules_from_settings()
    return {
        "schedules": schedules,
        "settings_file": str(SETTINGS_FILE.name)
    }


class ScheduleItemUpdate(BaseModel):
    data_type: str
    is_enabled: bool
    interval_type: str
    run_time: str
    target_option: str


class ScheduleBulkSaveRequest(BaseModel):
    schedules: list[ScheduleItemUpdate]


@router.post("/schedules")
def save_schedules(req: ScheduleBulkSaveRequest, db: Session = Depends(get_db)):
    current_schedules = _load_schedules_from_settings()
    cur_map = {item["data_type"]: item for item in current_schedules}
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for item in req.schedules:
        if item.data_type in cur_map:
            cur_map[item.data_type]["is_enabled"] = bool(item.is_enabled)
            cur_map[item.data_type]["interval_type"] = item.interval_type
            cur_map[item.data_type]["run_time"] = item.run_time
            cur_map[item.data_type]["target_option"] = item.target_option
            cur_map[item.data_type]["updated_at"] = now_str

        db.execute(text("""
            UPDATE admin_data_schedules
            SET is_enabled = :enabled,
                interval_type = :iv_type,
                run_time = :rtime,
                target_option = :topt
            WHERE data_type = :dtype
        """), {
            "enabled": item.is_enabled,
            "iv_type": item.interval_type,
            "rtime": item.run_time,
            "topt": item.target_option,
            "dtype": item.data_type
        })
    db.commit()

    # 전역 JSON 파일(mlb_news_settings.json)에 즉시 반영 후 백그라운드 워커 깨우기
    _save_schedules_to_settings(list(cur_map.values()))
    _scheduler_wake_event.set()

    return {
        "status": "success",
        "message": f"자동화 스케줄 설정이 전역 설정 파일({SETTINGS_FILE.name}) 및 DB에 저장되었습니다."
    }


# =========================================================
# 5. 백그라운드 자동화 실행 워커 (news.py 패턴과 동일)
# =========================================================
def _parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(str(dt_str)[:19])
    except ValueError:
        return None


def _parse_run_time_today(now: datetime, run_time_str: str) -> datetime:
    try:
        parts = str(run_time_str or "04:00").strip().split(":")
        hour = max(0, min(23, int(parts[0])))
        minute = max(0, min(59, int(parts[1]))) if len(parts) > 1 else 0
        return now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    except (ValueError, IndexError):
        return now.replace(hour=4, minute=0, second=0, microsecond=0)


def _is_schedule_due(item: dict, now: datetime) -> bool:
    """활성화된 스케줄 항목이 현재 실행 시점(Due)에 도달했는지 판별"""
    if not item.get("is_enabled"):
        return False

    iv_type = str(item.get("interval_type") or "DAILY").upper()
    last_run = _parse_datetime(item.get("last_run_at"))

    if iv_type == "EVERY_6H":
        return last_run is None or (now - last_run) >= timedelta(hours=6)

    if iv_type == "EVERY_12H":
        return last_run is None or (now - last_run) >= timedelta(hours=12)

    target_today = _parse_run_time_today(now, item.get("run_time", "04:00"))

    if iv_type == "DAILY":
        if now < target_today:
            return False
        return last_run is None or last_run.date() < now.date()

    if iv_type == "WEEKLY":
        if now < target_today:
            return False
        return last_run is None or (now - last_run) >= timedelta(days=7)

    return False


def _build_auto_fetch_request(item: dict, now: datetime) -> ManualFetchRequest:
    dtype = item.get("data_type", "PIPELINE_GAMES")
    t_opt = str(item.get("target_option") or "").strip()

    season = now.year
    start_date = (now - timedelta(days=2)).strftime("%Y-%m-%d")
    end_date = now.strftime("%Y-%m-%d")

    if t_opt.isdigit() and len(t_opt) == 4:
        season = int(t_opt)
        start_date = f"{season}-04-01"
        end_date = f"{season}-04-30"
    elif "~" in t_opt:
        parts = [p.strip() for p in t_opt.split("~", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            start_date, end_date = parts[0], parts[1]
            if start_date[:4].isdigit():
                season = int(start_date[:4])
    elif t_opt.upper() == "RECENT_3DAYS":
        start_date = (now - timedelta(days=2)).strftime("%Y-%m-%d")
        end_date = now.strftime("%Y-%m-%d")
        season = int(start_date[:4])

    return ManualFetchRequest(
        data_type=dtype,
        season=season,
        start_date=start_date,
        end_date=end_date,
        trigger_type="AUTO",
        refresh_pitcher_details=False,
    )


def baseball_scheduler_loop():
    """백그라운드에서 주기적으로 전역 설정 파일을 확인하여 예약된 야구 데이터 파이프라인 실행"""
    # 서버 부팅 직후 초기화 안정화를 위해 10초 대기 후 루프 진입
    _scheduler_wake_event.wait(10)

    while True:
        _scheduler_wake_event.clear()
        try:
            if not baseball_sync_lock.locked():
                now = datetime.now()
                schedules = _load_schedules_from_settings()
                for item in schedules:
                    if _is_schedule_due(item, now):
                        dtype = item["data_type"]
                        req = _build_auto_fetch_request(item, now)
                        print(f"[BaseballScheduler] 자동 실행 시작: {dtype} (옵션: {item.get('target_option')})")
                        _mark_schedule_last_run(dtype, now)
                        log_id = _create_sync_log(req)
                        _execute_pipeline_job(log_id, req)
                        break  # 한 틱에 하나씩 순차 처리
        except Exception as exc:
            print(f"[BaseballScheduler] 자동화 루프 예외: {exc}")

        # 30초마다 체크하되, 관리자가 설정을 새로 저장하면(_scheduler_wake_event.set) 즉시 깨어남
        _scheduler_wake_event.wait(30)


def start_background_baseball_scheduler():
    global _scheduler_started
    if _scheduler_started:
        return

    _scheduler_started = True
    threading.Thread(
        target=baseball_scheduler_loop,
        name="mlb-baseball-data-scheduler",
        daemon=True,
    ).start()


# =========================================================
# 6. 데이터 수집 기록(로그) 목록 조회
# =========================================================
@router.get("/logs")
def get_sync_logs(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT 
            log_id,
            data_type,
            trigger_type,
            target_param,
            status,
            records_affected,
            duration_sec,
            message,
            CAST(started_at AS CHAR) AS started_at,
            CAST(finished_at AS CHAR) AS finished_at
        FROM admin_data_sync_logs
        ORDER BY log_id DESC
        LIMIT :limit
    """), {"limit": limit}).mappings().all()

    logs = []
    for r in rows:
        item = dict(r)
        if item.get("duration_sec") is not None:
            item["duration_sec"] = float(item["duration_sec"])
        logs.append(item)

    return {"logs": logs}


# 모듈 로드 시 백그라운드 스케줄러 시작 (news.py와 동일한 패턴)
start_background_baseball_scheduler()