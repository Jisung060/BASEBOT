import uuid

from database.db_connection import engine

from sqlalchemy import text
from sqlalchemy.orm import Session

from langchain_google_genai import ChatGoogleGenerativeAI

from services.prediction_service import predictor
from services.rag_service import search_documents
from services.chat_db_service import get_database_context


# ==================================================
# Gemini
# ==================================================

llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.3
)


SYSTEM_PROMPT = """
너는 BASEBOT의 야구 전문 AI 챗봇이다.

BASEBOT은 야구 경기, 팀, 선수, 경기 결과,
선수 기록, 승부예측, 야구 규칙 및 커뮤니티 정보를
제공하는 서비스이다.

답변 규칙:

1. 반드시 한국어로 답변한다.
2. 사용자의 질문에 바로 답변한다.
3. 불필요한 인사말을 하지 않는다.
4. "안녕하세요! BASEBOT AI입니다."와 같은 고정 인사말을 반복하지 않는다.
5. DB에서 제공된 데이터가 있으면 해당 데이터를 우선 사용한다.
6. 존재하지 않는 경기나 선수 기록을 만들어내지 않는다.
7. ML 예측 확률을 임의로 변경하지 않는다.
8. RAG 자료가 제공되면 해당 자료를 우선 참고한다.
9. 사용자가 이해하기 쉽도록 설명한다.
10. DB에 없는 정보를 실제 DB 조회 결과인 것처럼 말하지 않는다.
11. 선수 기록이 제공되면 해당 기록의 기준 시즌을 구분해서 설명한다.
12. 예측 결과와 실제 경기 결과를 혼동하지 않는다.

답변 형식:

1. 답변은 일반 텍스트 형식으로 작성한다.
2. "##", "###", "#", "**", "__", "*", "`" 같은 Markdown 기호를 사용하지 않는다.
3. 제목을 만들기 위해 특수문자를 사용하지 않는다.
4. 내용이 바뀌는 부분에서는 반드시 줄바꿈한다.
5. 여러 내용을 설명할 경우 한 항목마다 줄을 바꾼다.
6. 긴 문장을 한 문단으로 이어서 작성하지 않는다.
7. 핵심 내용 → 설명 → 필요한 경우 예시 순서로 간단하게 작성한다.
8. 질문에 필요한 내용만 답변하고 불필요한 설명은 줄인다.
9. 마지막에 "더 궁금한 점이 있으면 질문하세요" 같은 문구를 넣지 않는다.

예시:

병살은 한 번의 수비 기회에서 아웃 카운트 2개를 잡아내는 플레이입니다.

가장 일반적인 상황은 주자가 1루에 있고 타자가 땅볼을 쳤을 때입니다.

수비수는 먼저 2루에서 주자를 아웃시킨 다음 1루로 공을 던져 타자 주자를 아웃시킵니다.

병살타는 이러한 병살 플레이의 결과로 타자가 아웃된 경우를 의미합니다.
"""


# ==================================================
# Gemini 응답 문자열 변환
# ==================================================

def normalize_response_content(content) -> str:
    """
    Gemini 응답이 문자열, 리스트, 딕셔너리 등
    어떤 형태로 반환되더라도 문자열로 변환한다.
    """

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        result = []

        for item in content:
            if isinstance(item, str):
                result.append(item)

            elif isinstance(item, dict):
                text_content = item.get("text")

                if text_content:
                    result.append(str(text_content))

        return "".join(result)

    if isinstance(content, dict):
        return str(content.get("text", content))

    return str(content)


# ==================================================
# Gemini 질문
# ==================================================

def ask_gemini(
    question: str,
    context: str = "",
    history: str = ""
) -> str:

    prompt = f"""
{SYSTEM_PROMPT}

[이전 대화]
{history}

[참고 데이터]
{context}

[사용자 질문]
{question}

위의 답변 규칙을 모두 지키면서
사용자의 질문에 정확하고 이해하기 쉽게 답변해라.

참고 데이터가 비어 있거나 질문과 관련이 없다면
존재하지 않는 DB 데이터나 기록을 만들어내지 마라.
"""

    response = llm.invoke(prompt)

    return normalize_response_content(response.content)


# ==================================================
# 세션 생성
# ==================================================

def create_chat_session(
    db: Session,
    user_id: int | None = None
) -> str:

    session_id = str(uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO chat_sessions
            (
                session_id,
                user_id,
                title
            )
            VALUES
            (
                :session_id,
                :user_id,
                :title
            )
        """),
        {
            "session_id": session_id,
            "user_id": user_id,
            "title": "새로운 대화"
        }
    )

    db.commit()

    return session_id


# ==================================================
# 세션 검증
# ==================================================

def validate_chat_session(
    db: Session,
    session_id: str | None,
    user_id: int | None = None
) -> str:
    """
    세션이 없거나 유효하지 않으면 새 세션을 생성한다.

    user_id가 전달된 경우 세션의 사용자 ID와 비교한다.
    로그인 사용자와 비로그인 사용자의 세션이 섞이지 않도록 한다.

    주의:
    비로그인 사용자끼리의 세션 접근을 완전히 차단하려면
    별도의 인증 또는 비밀 세션 토큰 검증이 필요하다.
    """

    if not session_id:
        return create_chat_session(db, user_id)

    row = db.execute(
        text("""
            SELECT user_id
            FROM chat_sessions
            WHERE session_id = :session_id
        """),
        {
            "session_id": session_id
        }
    ).mappings().first()

    if not row:
        return create_chat_session(db, user_id)

    session_user_id = row["user_id"]

    if session_user_id != user_id:
        return create_chat_session(db, user_id)

    return session_id


# ==================================================
# 이전 대화 조회
# ==================================================

def get_chat_history(
    db: Session,
    session_id: str
) -> str:
    """
    가장 최근 메시지 20개를 조회한 뒤
    오래된 메시지부터 시간순으로 정렬한다.
    """

    sql = text("""
        SELECT
            role,
            content
        FROM (
            SELECT
                message_id,
                role,
                content,
                created_at
            FROM chat_messages
            WHERE session_id = :session_id
            ORDER BY
                created_at DESC,
                message_id DESC
            LIMIT 20
        ) AS recent_messages
        ORDER BY
            created_at ASC,
            message_id ASC
    """)

    rows = db.execute(
        sql,
        {
            "session_id": session_id
        }
    ).mappings().all()

    history = []

    for row in rows:
        history.append(
            f'{row["role"]}: {row["content"]}'
        )

    return "\n".join(history)


# ==================================================
# 메시지 저장
# ==================================================

def save_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
    generated_sql: str | None = None
):
    """
    사용자 질문 또는 AI 답변을 DB에 저장한다.
    """

    content = normalize_response_content(content)

    db.execute(
        text("""
            INSERT INTO chat_messages
            (
                session_id,
                role,
                content,
                generated_sql
            )
            VALUES
            (
                :session_id,
                :role,
                :content,
                :generated_sql
            )
        """),
        {
            "session_id": session_id,
            "role": role,
            "content": content,
            "generated_sql": generated_sql
        }
    )

    db.commit()


# ==================================================
# 경기 조회 (기존 기능 유지)
# ==================================================

def get_recent_games(
    db: Session
) -> str:

    sql = text("""
        SELECT
            g.game_id,
            g.game_date,
            g.game_time,
            home.team_name AS home_team,
            away.team_name AS away_team,
            g.home_score,
            g.away_score,
            g.status
        FROM games g
        JOIN teams home
            ON g.home_team_id = home.team_id
        JOIN teams away
            ON g.away_team_id = away.team_id
        ORDER BY
            g.game_date DESC,
            g.game_time DESC
        LIMIT 10
    """)

    rows = db.execute(sql).mappings().all()

    if not rows:
        return ""

    result = []

    for row in rows:
        result.append(
            f"""
경기 ID: {row["game_id"]}
날짜: {row["game_date"]}
시간: {row["game_time"]}
홈팀: {row["home_team"]}
원정팀: {row["away_team"]}
홈팀 점수: {row["home_score"]}
원정팀 점수: {row["away_score"]}
상태: {row["status"]}
"""
        )

    return "\n".join(result)


# ==================================================
# 선수 정보 조회 (기존 기능 유지)
# ==================================================

def get_player_data(
    db: Session
) -> str:

    sql = text("""
        SELECT
            p.player_id,
            p.player_name,
            p.position,
            t.team_name
        FROM players p
        LEFT JOIN teams t
            ON p.team_id = t.team_id
        ORDER BY p.player_name
        LIMIT 50
    """)

    rows = db.execute(sql).mappings().all()

    if not rows:
        return ""

    result = []

    for row in rows:
        result.append(
            f"""
선수 ID: {row["player_id"]}
선수명: {row["player_name"]}
포지션: {row["position"]}
소속팀: {row["team_name"]}
"""
        )

    return "\n".join(result)


# ==================================================
# 선수 기록 분석 (기존 기능 유지)
# ==================================================

def analyze_player_stats(
    db: Session
) -> str:

    sql = text("""
        SELECT
            p.player_name,
            t.team_name,
            s.season,
            s.games,
            s.batting_avg,
            s.hits,
            s.home_runs,
            s.rbi,
            s.era,
            s.bwar,
            s.fwar,
            s.wrc_plus
        FROM player_season_stats s
        JOIN players p
            ON s.player_id = p.player_id
        LEFT JOIN teams t
            ON p.team_id = t.team_id
        ORDER BY
            s.season DESC,
            s.home_runs DESC
        LIMIT 30
    """)

    rows = db.execute(sql).mappings().all()

    if not rows:
        return ""

    result = []

    for row in rows:
        result.append(
            f"""
선수: {row["player_name"]}
팀: {row["team_name"]}
시즌: {row["season"]}
경기: {row["games"]}
타율: {row["batting_avg"]}
안타: {row["hits"]}
홈런: {row["home_runs"]}
타점: {row["rbi"]}
ERA: {row["era"]}
bWAR: {row["bwar"]}
fWAR: {row["fwar"]}
wRC+: {row["wrc_plus"]}
"""
        )

    return "\n".join(result)


# ==================================================
# 사용자 정보 조회 (기존 기능 유지)
# ==================================================

def get_user_data(
    db: Session,
    user_id: int
):

    sql = text("""
        SELECT
            u.username,
            u.nickname,
            u.point,
            u.grade,
            u.prediction_streak,
            u.max_prediction_streak,
            t.team_name AS favorite_team
        FROM users u
        LEFT JOIN teams t
            ON u.favorite_team_id = t.team_id
        WHERE u.user_id = :user_id
    """)

    return db.execute(
        sql,
        {
            "user_id": user_id
        }
    ).mappings().first()


# ==================================================
# 질문 유형 판단 (기존 기능 유지)
# ==================================================

def classify_question(
    question: str
) -> str:
    """
    질문의 목적에 따라 처리 유형을 구분한다.
    """

    q = question.strip().lower()

    baseball_terms = (
        "ops", "era", "whip", "war", "wrc+", "병살", "삼진",
        "볼넷", "스트라이크", "번트", "희생플라이", "도루",
        "폭투", "보크", "인필드 플라이", "타율", "출루율",
        "장타율", "자책점", "퀄리티 스타트", "퍼펙트게임",
        "노히트노런"
    )

    definition_patterns = (
        "뭐야", "무엇", "무슨 뜻", "뜻이 뭐", "의미",
        "설명해", "알려줘", "란?", "이란", "란 무엇"
    )

    contains_baseball_term = any(term in q for term in baseball_terms)
    asks_definition = any(pattern in q for pattern in definition_patterns)

    if contains_baseball_term and asks_definition:
        return "rag"

    if contains_baseball_term and len(q) <= 25:
        return "rag"

    rule_keywords = (
        "야구 규칙", "규칙이 뭐", "몇 이닝", "아웃이 몇",
        "스트라이크 존", "경기 규칙", "야구 용어"
    )

    if any(keyword in q for keyword in rule_keywords):
        return "rag"

    personal_keywords = (
        "내 포인트", "내 점수", "내 등급", "내 관심팀",
        "내가 좋아하는 팀", "내 예측", "내 정보", "내 연승"
    )

    if any(keyword in q for keyword in personal_keywords):
        return "personal"

    prediction_keywords = (
        "승부예측", "승률", "누가 이길", "누가 이겨", "승부",
        "예측", "승리 가능성", "이길 가능성", "경기 예상", "경기 전망"
    )

    if any(keyword in q for keyword in prediction_keywords):
        return "prediction"

    analysis_keywords = (
        "분석", "통계", "기록", "타율", "홈런", "타점", "era",
        "ops", "war", "wrc+", "whip", "출루율", "장타율",
        "방어율", "자책점", "탈삼진", "안타"
    )

    if any(keyword in q for keyword in analysis_keywords):
        return "analysis"

    game_keywords = (
        "오늘 경기", "경기 일정", "경기 결과", "경기 스코어",
        "경기 현황", "최근 경기", "어제 경기", "내일 경기", "경기 목록"
    )

    if any(keyword in q for keyword in game_keywords):
        return "database"

    player_keywords = (
        "선수 명단", "선수 정보", "선수 목록", "선수 소개",
        "선수", "투수", "타자", "포수", "외야수", "내야수", "소속 선수"
    )

    if any(keyword in q for keyword in player_keywords):
        return "player"

    team_keywords = (
        "팀 정보", "팀 순위", "구단", "팀 목록", "팀 소개", "팀"
    )

    if any(keyword in q for keyword in team_keywords):
        return "database"

    baseball_keywords = (
        "야구", "투수", "타자", "포수", "외야수", "내야수", "야구 경기"
    )

    if any(keyword in q for keyword in baseball_keywords):
        return "baseball"

    return "general"


# ==================================================
# 전체 챗봇
# ==================================================

def chat_with_ai(
    question: str,
    db: Session,
    session_id: str | None = None,
    user_id: int | None = None
):
    """
    BASEBOT AI 챗봇 처리 과정.

    기존 세션, 대화 기록, 개인 정보, ML 예측, RAG 흐름을 유지하면서
    chat_db_service의 DB 조회 결과를 우선 컨텍스트로 사용한다.
    """

    question = question.strip()

    if not question:
        return session_id, "질문 내용을 입력해 주세요."

    # 1. 세션 검증 또는 생성
    session_id = validate_chat_session(
        db=db,
        session_id=session_id,
        user_id=user_id
    )

    # 2. 이전 대화 조회
    history = get_chat_history(
        db=db,
        session_id=session_id
    )

    # 3. 사용자 질문 저장
    save_message(
        db=db,
        session_id=session_id,
        role="USER",
        content=question
    )

    # 4. 질문 분류
    question_type = classify_question(question)
    print(f"[챗봇 질문 유형] {question_type}")

    context = ""
    generated_sql = None

    # 5. 추가된 DB 조회 서비스 실행
    # 관련 DB 질문이면 조회 결과를 사용하고,
    # 해당하지 않으면 None이 반환되어 기존 분기로 진행한다.
    if question_type in ("personal", "rag"):
        database_context = None
    else:
        database_context = get_database_context(
            db=db,
            question=question
        )

    if database_context is not None:
        context = f"""
[BASEBOT DB 조회 결과]

{database_context}

위 내용은 BASEBOT 데이터베이스에서 조회한 결과이다.
조회 결과에 없는 정보는 만들어내지 마라.
DB 조회 결과가 없거나 오류라고 표시되면 그 사실을 그대로 설명해라.
"""

    # 6. 기존 분기 유지: DB 서비스가 처리하지 않은 질문만 처리
    elif question_type == "personal":

        if user_id is not None:
            user = get_user_data(
                db=db,
                user_id=user_id
            )

            if user:
                context = f"""
[DB 사용자 정보]

닉네임: {user["nickname"]}
포인트: {user["point"]}
등급: {user["grade"]}
현재 연속 적중: {user["prediction_streak"]}
최대 연속 적중: {user["max_prediction_streak"]}
관심 팀: {user["favorite_team"]}
"""
            else:
                context = (
                    "DB에서 해당 사용자의 정보를 찾을 수 없다. "
                    "사용자 정보를 임의로 만들어내지 마라."
                )
        else:
            context = (
                "현재 로그인한 사용자의 ID가 전달되지 않았다. "
                "개인 정보는 조회할 수 없으므로 로그인이 필요하다고 안내해라."
            )

    elif question_type == "prediction":

        try:
            with engine.connect() as conn:
                home_team, away_team = predictor.find_teams_from_question(
                    conn,
                    question
                )

            if home_team is None or away_team is None:
                context = """
사용자가 경기 승부예측을 요청했다.
질문에서 예측할 두 팀을 찾지 못했다.
사용자에게 예측을 원하는 두 팀의 이름을 입력해 달라고 안내해라.

예시:
양키스와 레드삭스 중 누가 이길까?
다저스와 파드리스 승부예측 해줘.
"""
            else:
                prediction = predictor.predict_matchup(
                    home_team_id=home_team["team_id"],
                    away_team_id=away_team["team_id"]
                )

                context = f"""
[경기 예측 머신러닝 결과]

홈팀:
{prediction["home_team_name"]}

원정팀:
{prediction["away_team_name"]}

홈팀 승리 확률:
{prediction["home_win_prob"]}%

원정팀 승리 확률:
{prediction["away_win_prob"]}%

모델 예측 승리팀:
{prediction["predicted_winner_name"]}

[상대전적]

{prediction["head_to_head_summary"]}

총 맞대결:
{prediction["head_to_head"]["total_games"]}경기

홈팀 승리:
{prediction["head_to_head"]["team_a_wins"]}승

원정팀 승리:
{prediction["head_to_head"]["team_b_wins"]}승

[주요 팀 지표]

홈팀 평균 타구속도:
{prediction["metrics_comparison"]["home_avg_exit_velo"]}

원정팀 평균 타구속도:
{prediction["metrics_comparison"]["away_avg_exit_velo"]}

홈팀 배럴 타구 비율:
{prediction["metrics_comparison"]["home_barrel_pct"]}%

원정팀 배럴 타구 비율:
{prediction["metrics_comparison"]["away_barrel_pct"]}%

홈팀 평균 bWAR:
{prediction["metrics_comparison"]["home_avg_bwar"]}

원정팀 평균 bWAR:
{prediction["metrics_comparison"]["away_avg_bwar"]}

홈팀 타율:
{prediction["metrics_comparison"]["home_batting_avg"]}

원정팀 타율:
{prediction["metrics_comparison"]["away_batting_avg"]}

위 결과는 BASEBOT의 RandomForest 머신러닝 모델이 계산한 예측 결과이다.
모델의 승리 확률과 예측 승리팀을 임의로 변경하지 마라.
실제 경기 결과를 알고 있는 것처럼 말하지 마라.
예측은 참고용 결과임을 간단하게 안내할 수 있다.
"""

        except FileNotFoundError as e:
            print(f"[경기 예측 모델 파일 오류] {e}")
            context = """
경기 예측 모델 파일을 사용할 수 없다.
현재 경기 예측 기능을 사용할 수 없다고 안내해라.
"""
        except Exception as e:
            print(f"[경기 예측 오류] {e}")
            context = """
경기 예측을 처리하는 과정에서 오류가 발생했다.
현재 경기 예측을 처리할 수 없다고 간단하게 안내해라.
"""

    elif question_type == "analysis":

        stats = analyze_player_stats(db)

        if stats:
            context = f"""
[DB 선수 시즌 기록]

{stats}

위 데이터는 DB에서 조회한 선수 시즌 기록이다.
제공된 기록에 근거해서 답변해라.
질문에 해당하는 선수나 기록이 명확하지 않으면
그 사실을 안내하고 임의로 수치를 만들어내지 마라.
"""
        else:
            context = (
                "DB에서 조회된 선수 시즌 통계 데이터가 없다. "
                "기록을 임의로 만들어내지 마라."
            )

    elif question_type == "database":

        games = get_recent_games(db)

        if games:
            context = f"""
[DB 경기 데이터]

{games}

위 데이터는 DB에서 조회한 최근 경기 목록이다.
제공된 경기 데이터에 근거해서 답변해라.
DB에 없는 경기 일정이나 결과는 만들어내지 마라.
"""
        else:
            context = (
                "DB에서 조회된 경기 데이터가 없다. "
                "경기 일정이나 결과를 임의로 만들어내지 마라."
            )

    elif question_type == "player":

        players = get_player_data(db)

        if players:
            context = f"""
[DB 선수 정보]

{players}

위 데이터는 DB에서 조회한 선수 정보이다.
제공된 선수명, 포지션, 소속팀에 근거해서 답변해라.
조회 결과에 없는 정보는 만들어내지 마라.
"""
        else:
            context = (
                "DB에서 조회된 선수 정보가 없다. "
                "선수 정보를 임의로 만들어내지 마라."
            )

    elif question_type == "rag":

        try:
            documents = search_documents(question, k=3)

            if documents:
                context = "\n\n".join(
                    document.page_content
                    for document in documents
                )
            else:
                context = """
질문과 관련된 야구 문서를 찾지 못했다.
확실하지 않은 규칙이나 기록을 사실처럼 만들어내지 마라.
일반적으로 확실하게 알려진 야구 지식만 설명해라.
"""
        except Exception as e:
            print(f"[RAG 검색 오류] {e}")
            context = """
야구 문서 검색 과정에서 오류가 발생했다.
검색 결과를 조회하지 못했음을 고려해 답변해라.
"""

    elif question_type == "baseball":

        try:
            documents = search_documents(question, k=3)

            if documents:
                context = "\n\n".join(
                    document.page_content
                    for document in documents
                )
            else:
                context = """
사용자는 야구와 관련된 질문을 하고 있다.
야구 규칙, 경기 방식, 포지션 등에 대해 정확하고 이해하기 쉽게 설명해라.
확실하지 않은 정보는 사실처럼 단정하지 마라.
"""
        except Exception as e:
            print(f"[야구 문서 검색 오류] {e}")
            context = """
사용자는 야구와 관련된 질문을 하고 있다.
확실하게 알고 있는 야구 지식을 중심으로 설명해라.
"""

    else:
        context = """
사용자의 질문에 한국어로 간결하고 정확하게 답변해라.
BASEBOT의 DB에서 조회하지 않은 정보는 DB 조회 결과인 것처럼 설명하지 마라.
"""

    # 7. Gemini 답변 생성
    answer = ask_gemini(
        question=question,
        context=context,
        history=history
    )

    # 8. AI 답변 저장
    save_message(
        db=db,
        session_id=session_id,
        role="ASSISTANT",
        content=answer,
        generated_sql=generated_sql
    )

    # 9. 결과 반환
    return session_id, answer
