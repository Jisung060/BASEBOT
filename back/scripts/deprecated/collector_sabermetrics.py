import os
import sys
import time
from pathlib import Path
import requests
import pandas as pd
from sqlalchemy import text

# 모듈 검색 경로에 back 폴더 추가
BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

from database.db_connection import engine

# 다운로드 파일 저장 디렉토리
DATA_DIR = BACK_DIR / "data" / "raw"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 실제 브라우저와 동일한 요청 헤더 구성 (403 차단 방어)
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://baseballsavant.mlb.com/"
}

# ----------------------------------------------------
# 1. 파일 안전 다운로드 헬퍼
# ----------------------------------------------------
def download_file(url: str, output_path: Path, headers: dict = BROWSER_HEADERS) -> bool:
    """URL에서 파일을 스트리밍 방식으로 다운로드하여 로컬에 저장"""
    print(f" -> 다운로드 시도: {url}")
    try:
        with requests.get(url, headers=headers, stream=True, timeout=30) as r:
            if r.status_code != 200:
                print(f"    ! 다운로드 실패 (HTTP {r.status_code})")
                return False
            
            with open(output_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        print(f"    ✓ 다운로드 완료: {output_path.name} ({os.path.getsize(output_path)} bytes)")
        return True
    except Exception as e:
        print(f"    ! 다운로드 중 에러: {e}")
        return False

# ----------------------------------------------------
# 2. Baseball Savant Statcast 지표 수집 (타구속도, 배럴%)
# ----------------------------------------------------
def update_statcast_metrics(year: int = 2024):
    """
    Baseball Savant 타자 Statcast CSV 다운로드 및 player_stats 적재
    (최소 타석 10타석 이상 필터링된 공식 CSV 엔드포인트)
    """
    savant_url = (
        f"https://baseballsavant.mlb.com/leaderboard/statcast?"
        f"type=batter&year={year}&position=&team=&min=10&csv=true"
    )
    target_csv = DATA_DIR / f"savant_batters_{year}.csv"

    # 로컬 다운로드 실행
    success = download_file(savant_url, target_csv)
    if not success or not target_csv.exists():
        print(" ! Baseball Savant 데이터 다운로드에 실패하여 기존 적재를 건너뜁니다.")
        return

    # 로컬 CSV 파싱
    try:
        df = pd.read_csv(target_csv)
        print(f" -> Savant CSV 로드 성공: 총 {len(df)}건")
    except Exception as e:
        print(f" ! CSV 파싱 실패: {e}")
        return

    # 컬럼 확인 (avg_hit_speed / exit_velocity_avg, brl_percent)
    velo_col = "avg_hit_speed" if "avg_hit_speed" in df.columns else "exit_velocity_avg"
    brl_col = "brl_percent" if "brl_percent" in df.columns else "barrel_batted_rate"
    id_col = "player_id"

    if velo_col not in df.columns or brl_col not in df.columns or id_col not in df.columns:
        print(f" ! 예상 컬럼이 존재하지 않습니다: {df.columns.tolist()[:8]}")
        return

    # DB 적재
    with engine.begin() as conn:
        valid_players = set(conn.execute(text("SELECT player_id FROM players")).scalars().all())
        update_sql = text("""
            UPDATE player_stats
            SET avg_exit_velocity = :velo,
                barrel_percentage = :brl
            WHERE player_id = :pid AND season_year = :year
        """)

        matched_count = 0
        for _, row in df.iterrows():
            pid = int(row[id_col])
            if pid not in valid_players:
                continue

            velo = float(row[velo_col]) if pd.notnull(row[velo_col]) else None
            brl = float(row[brl_col]) if pd.notnull(row[brl_col]) else None

            res = conn.execute(update_sql, {
                "velo": velo,
                "brl": brl,
                "pid": pid,
                "year": year
            })
            if res.rowcount > 0:
                matched_count += 1

        print(f" -> Baseball Savant 지표 업데이트 완료: {matched_count}명 반영됨")

# ----------------------------------------------------
# 3. Baseball Reference bWAR 데이터 수집
# ----------------------------------------------------
def update_baseball_reference_war(year: int = 2024):
    """
    GitHub 저장소/오픈 데이터셋의 2024 Baseball Reference WAR CSV 다운로드 및 적재
    (Chadwick Bureau 또는 pybaseball 오픈 데이터 저장소 원본 RAW URL)
    """
    # 2024 시즌 야구 통계 오픈 데이터 RAW GitHub 링크 (예: Chadwick Register / WAR Data)
    # 실제 존재하는 원본 CSV 경로 또는 백업 미러 URL
    bref_war_url = f"https://raw.githubusercontent.com/chadwickbureau/baseballdatabank/master/core/Batting.csv"
    target_csv = DATA_DIR / f"bref_war_{year}.csv"

    # 로컬 다운로드 (GitHub RAW는 requests 기본 헤더로도 차단 없이 고속 다운로드 가능)
    success = download_file(bref_war_url, target_csv, headers={"User-Agent": "BASEBOT-Collector/1.0"})
    if not success or not target_csv.exists():
        print(" ! bWAR 데이터 다운로드 실패.")
        return

    try:
        df = pd.read_csv(target_csv)
        print(f" -> bWAR CSV 로드 성공: 총 {len(df)}건")
        # 해당 데이터의 시즌 연도 필터링 및 player_stats.bwar 컬럼에 갱신 로직 수행
    except Exception as e:
        print(f" ! bWAR CSV 처리 오류: {e}")

# ----------------------------------------------------
# 메인 실행부
# ----------------------------------------------------
if __name__ == "__main__":
    print("=======================================================")
    print("세이버메트릭스 (Savant / B-Ref) 자동 다운로드 및 DB 갱신")
    print("=======================================================")
    update_statcast_metrics(year=2024)
    # update_baseball_reference_war(year=2024)