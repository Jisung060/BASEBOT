
"""
BASEBOT 선수 영어 이름 → 한국어 이름 변환 및 DB 저장

파일 위치:
    back/scripts/translate_player_names_ko.py

실행 위치:
    back/

필요 환경변수:
    GOOGLE_API_KEY 또는 GEMINI_API_KEY

주의:
- player_name 원본은 수정하지 않습니다.
- player_name_ko가 NULL 또는 빈 문자열인 선수만 처리합니다.
- 한국어 변환 결과를 확인한 뒤 해당 선수 ID에 저장합니다.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import time
from pathlib import Path

# back 디렉터리를 Python 모듈 검색 경로에 추가
BACK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACK_DIR))

from sqlalchemy import text
from database.db_connection import engine
from langchain_google_genai import ChatGoogleGenerativeAI


MODEL_NAME = "gemini-3.1-flash-lite"
BATCH_SIZE = 30
MAX_RETRIES = 3


def create_model():
    """Gemini 모델 생성"""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError(
            "GOOGLE_API_KEY 또는 GEMINI_API_KEY 환경변수를 설정해 주세요."
        )

    return ChatGoogleGenerativeAI(
        model=MODEL_NAME,
        google_api_key=api_key,
        temperature=0,
    )


def parse_json_response(content: str) -> list[dict]:
    """Gemini 응답에서 JSON 배열을 추출하고 파싱한다."""

    if not content:
        raise ValueError("Gemini 응답이 비어 있습니다.")

    content = content.strip()

    # Markdown 코드 블록 제거
    content = re.sub(
        r"^\s*```(?:json)?\s*",
        "",
        content,
        flags=re.IGNORECASE,
    )
    content = re.sub(r"\s*```\s*$", "", content)

    # JSON 배열 부분만 추출
    start = content.find("[")
    end = content.rfind("]")

    if start < 0 or end < start:
        raise ValueError(
            f"JSON 배열을 찾을 수 없습니다: {content[:500]!r}"
        )

    json_text = content[start:end + 1].strip()

    # 1차: 정상적인 JSON 파싱
    try:
        result = json.loads(json_text)
    except json.JSONDecodeError as json_error:
        # 2차: 작은따옴표를 사용하는 Python 리터럴 형식 처리
        try:
            result = ast.literal_eval(json_text)
        except (ValueError, SyntaxError):
            raise ValueError(
                "Gemini 응답이 올바른 JSON 형식이 아닙니다. "
                f"JSON 오류: {json_error}. "
                f"원본 응답: {json_text[:1000]!r}"
            ) from json_error

    if not isinstance(result, list):
        raise ValueError("Gemini 응답이 JSON 배열이 아닙니다.")

    if not all(isinstance(item, dict) for item in result):
        raise ValueError("JSON 배열에 객체가 아닌 항목이 포함되어 있습니다.")

    return result


def translate_batch(model, players: list[dict]) -> dict[int, str]:
    """
    선수 이름을 한국어로 변환한다.
    Gemini 응답의 선수 ID 대신 입력 순번으로 원본 ID를 연결한다.
    """

    expected = {
        int(player["player_id"]): str(player["player_name"])
        for player in players
    }

    payload = [
        f"{index}|{player['player_name']}"
        for index, player in enumerate(players, start=1)
    ]

    prompt = f"""
너는 MLB 선수 이름의 한국어 표기를 만드는 담당자다.

아래 선수들의 이름을 한국 야구 중계에서 사용하는
자연스러운 한국어 음역으로 변환하라.

규칙:
1. 이름의 뜻을 번역하지 말고 발음을 한글로 표기한다.
2. 선수의 이름과 성을 모두 표기한다.
3. 입력된 선수의 순번을 절대 바꾸지 않는다.
4. 모든 선수에 대해 빠짐없이 한 줄씩 출력한다.
5. 선수 이름 앞에 입력된 순번과 | 기호를 그대로 붙인다.
6. 설명, JSON, Markdown 코드 블록은 출력하지 않는다.

출력 예시:
1|저스틴 벌랜더
2|데이비드 페랄타
3|켄리 잰슨

변환할 선수:
{chr(10).join(payload)}
"""

    response = model.invoke(prompt)

    # Gemini/LangChain 응답이 문자열 또는 콘텐츠 블록 목록인 경우 처리
    content = response.content

    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
            elif isinstance(block, str):
                parts.append(block)
        content = "\n".join(parts)
    elif not isinstance(content, str):
        content = str(content)

    print(f"Gemini 응답 길이: {len(content)}자")

    # 순번별 한국어 이름 추출
    translated_by_index: dict[int, str] = {}

    for line in content.splitlines():
        line = line.strip()

        match = re.match(r"^(\d+)\s*[|.)、:-]\s*(.+?)\s*$", line)
        if not match:
            continue

        index = int(match.group(1))
        name_ko = match.group(2).strip()

        if index < 1 or index > len(players):
            continue

        # 응답이 영어 이름이나 빈 문자열이면 사용하지 않는다.
        if not name_ko or not re.search(r"[가-힣]", name_ko):
            continue

        translated_by_index[index] = name_ko

    # 입력 순번을 원래 player_id에 연결
    translations: dict[int, str] = {}

    for index, player in enumerate(players, start=1):
        name_ko = translated_by_index.get(index)

        if name_ko:
            translations[int(player["player_id"])] = name_ko

    missing_ids = set(expected) - set(translations)

    if missing_ids:
        missing_details = [
            {
                "player_id": player_id,
                "player_name": expected[player_id],
            }
            for player_id in sorted(missing_ids)
        ]

        print("\n===== Gemini 원본 응답 =====")
        print(content[:5000])
        print("===== 원본 응답 끝 =====")

        raise ValueError(
            f"한국어 이름 변환 누락: {missing_details}"
        )

    return translations


def load_untranslated_players() -> list[dict]:
    """한국어 이름이 없는 선수 조회"""
    query = text("""
        SELECT player_id, player_name
        FROM players
        WHERE player_name_ko IS NULL
           OR TRIM(player_name_ko) = ''
        ORDER BY player_id
    """)

    with engine.connect() as conn:
        rows = conn.execute(query).mappings().all()

    return [dict(row) for row in rows]


def save_translations(translations: dict[int, str]) -> int:
    """한국어 이름 저장. 기존 값이 있으면 덮어쓰지 않음"""
    if not translations:
        return 0

    update_sql = text("""
        UPDATE players
        SET player_name_ko = :name_ko
        WHERE player_id = :player_id
          AND (
              player_name_ko IS NULL
              OR TRIM(player_name_ko) = ''
          )
    """)

    params = [
        {"player_id": player_id, "name_ko": name_ko}
        for player_id, name_ko in translations.items()
    ]

    with engine.begin() as conn:
        result = conn.execute(update_sql, params)

    return result.rowcount


def main():
    model = create_model()
    players = load_untranslated_players()

    if not players:
        print("모든 선수의 한국어 이름이 이미 저장되어 있습니다.")
        return

    total = len(players)
    saved = 0

    print(f"한국어 이름이 없는 선수: {total}명")
    print(f"모델: {MODEL_NAME}")
    print(f"배치 크기: {BATCH_SIZE}")

    for start in range(0, total, BATCH_SIZE):
        batch = players[start:start + BATCH_SIZE]
        batch_number = start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        print(
            f"\n[{batch_number}/{total_batches}] "
            f"{len(batch)}명 변환 중..."
        )

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                translations = translate_batch(model, batch)
                count = save_translations(translations)
                saved += count

                for player in batch:
                    player_id = int(player["player_id"])
                    print(
                        f"{player['player_name']} → "
                        f"{translations[player_id]}"
                    )

                print(f"저장 완료: {count}명")
                break

            except Exception as exc:
                print(
                    f"오류 ({attempt}/{MAX_RETRIES}): {exc}"
                )

                if attempt == MAX_RETRIES:
                    print(
                        "이번 배치는 저장하지 못했습니다. "
                        "스크립트를 다시 실행하면 누락된 선수부터 처리합니다."
                    )
                    raise

                time.sleep(2 * attempt)

    print("\n변환 작업 완료")
    print(f"이번 실행에서 저장한 선수: {saved}명")


if __name__ == "__main__":
    main()
