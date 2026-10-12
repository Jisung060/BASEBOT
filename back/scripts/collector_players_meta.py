import sys
import time
from pathlib import Path

BACK_DIR = Path(__file__).resolve().parent.parent
if str(BACK_DIR) not in sys.path:
    sys.path.insert(0, str(BACK_DIR))

import pandas as pd
import requests
from sqlalchemy import text
from database.db_connection import engine
from pybaseball import playerid_reverse_lookup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def update_players_metadata_via_pybaseball():
    print("========================================================")
    print("pybaseball & MLB API 기반 players 메타데이터 전수 갱신")
    print("========================================================")

    with engine.begin() as conn:
        existing_ids = conn.execute(text("SELECT player_id FROM players")).scalars().all()

    if not existing_ids:
        print("DB에 선수가 존재하지 않습니다.")
        return

    print(f" -> DB 등록 선수 총 {len(existing_ids)}명 확인.")

    # 1. pybaseball의 검증된 역방향 ID 매핑 (MLBAM ID -> BRef, FanGraphs ID)
    print("\n[1/2] pybaseball 역방향 ID 매핑(BRef, FanGraphs ID) 조회 중...")
    try:
        # key_type='mlbam'으로 우리 DB의 player_id 목록을 넘김
        id_lookup_df = playerid_reverse_lookup(existing_ids, key_type='mlbam')
        
        # 컬럼 정리: key_mlbam, key_bbref, key_fangraphs
        id_map = id_lookup_df[['key_mlbam', 'key_bbref', 'key_fangraphs']].dropna(subset=['key_mlbam']).copy()
        id_map.rename(columns={
            'key_mlbam': 'player_id',
            'key_bbref': 'bbref_id',
            'key_fangraphs': 'fangraphs_id'
        }, inplace=True)
        id_map['player_id'] = id_map['player_id'].astype(int)
        print(f" -> pybaseball 매핑 성공: {len(id_map)}명 매핑 확보 완료!")
    except Exception as e:
        print(f"※ pybaseball ID 매핑 실패 ({e}). 기본 빈 데이터로 진행합니다.")
        id_map = pd.DataFrame(columns=['player_id', 'bbref_id', 'fangraphs_id'])

    # 2. MLB 공식 People API: 등번호, 포지션, 생일, 투타
    print("\n[2/2] MLB People API에서 상세 프로필(등번호, 포지션, 투타, 생일) 수집 중...")
    bio_records = []
    chunk_size = 50
    for i in range(0, len(existing_ids), chunk_size):
        chunk = existing_ids[i:i + chunk_size]
        ids_str = ",".join(map(str, chunk))
        url = f"https://statsapi.mlb.com/api/v1/people?personIds={ids_str}"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code == 200:
                for p in resp.json().get("people", []):
                    bio_records.append({
                        "player_id": int(p.get("id")),
                        "jersey_number": p.get("primaryNumber"),
                        "position": p.get("primaryPosition", {}).get("abbreviation"),
                        "birth_date": p.get("birthDate"),
                        "bats": p.get("batSide", {}).get("code"),
                        "throws": p.get("pitchHand", {}).get("code")
                    })
        except Exception as e:
            print(f"※ 청크 [{i}~] 바이오 수집 실패: {e}")
        time.sleep(0.15)

    bio_df = pd.DataFrame(bio_records)

    # 3. 데이터 병합 후 DB 일괄 UPDATE
    target_df = pd.DataFrame({"player_id": existing_ids})
    merged = pd.merge(target_df, bio_df, on="player_id", how="left")
    merged = pd.merge(merged, id_map, on="player_id", how="left")

    print("\n[3/3] DB players 테이블 일괄 UPDATE 실행...")
    with engine.begin() as conn:
        update_sql = text("""
            UPDATE players
            SET bbref_id = COALESCE(:bbref_id, bbref_id),
                fangraphs_id = COALESCE(:fangraphs_id, fangraphs_id),
                jersey_number = COALESCE(:jersey_number, jersey_number),
                position = COALESCE(:position, position),
                birth_date = COALESCE(:birth_date, birth_date),
                bats = COALESCE(:bats, bats),
                throws = COALESCE(:throws, throws)
            WHERE player_id = :player_id
        """)

        updated_count = 0
        for _, row in merged.iterrows():
            fg_id = str(row['fangraphs_id']) if pd.notnull(row.get('fangraphs_id')) else None
            if fg_id and fg_id.endswith('.0'):
                fg_id = fg_id[:-2]

            res = conn.execute(update_sql, {
                "player_id": int(row['player_id']),
                "bbref_id": str(row['bbref_id']) if pd.notnull(row.get('bbref_id')) else None,
                "fangraphs_id": fg_id,
                "jersey_number": str(row['jersey_number']) if pd.notnull(row.get('jersey_number')) else None,
                "position": str(row['position']) if pd.notnull(row.get('position')) else None,
                "birth_date": str(row['birth_date']) if pd.notnull(row.get('birth_date')) else None,
                "bats": str(row['bats']) if pd.notnull(row.get('bats')) else None,
                "throws": str(row['throws']) if pd.notnull(row.get('throws')) else None,
            })
            if res.rowcount > 0:
                updated_count += 1

    print(f"\n>>> players 테이블 {updated_count}명의 모든 메타데이터 갱신 완료!")

if __name__ == "__main__":
    update_players_metadata_via_pybaseball()