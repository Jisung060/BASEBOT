import uuid

from database.db_connection import engine

from sqlalchemy import text
from sqlalchemy.orm import Session

from langchain_google_genai import ChatGoogleGenerativeAI
from services.prediction_service import predictor
from services.rag_service import search_documents


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
# Gemini 질문
# ==================================================

def ask_gemini(
    question: str,
    context: str = "",
    history: str = ""
):

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
"""

    response = llm.invoke(prompt)

    # Gemini 응답이 문자열인 경우
    if isinstance(response.content, str):
        return response.content

    # Gemini 응답이 리스트인 경우
    if isinstance(response.content, list):

        result = []

        for item in response.content:

            if isinstance(item, str):
                result.append(item)

            elif isinstance(item, dict):

                text_content = item.get("text")

                if text_content:
                    result.append(text_content)

        return "".join(result)

    # 그 외의 경우
    return str(response.content)


# ==================================================
# 세션 생성
# ==================================================

def create_chat_session(
    db: Session,
    user_id: int | None = None
):

    session_id = str(
        uuid.uuid4()
    )

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
# 이전 대화
# ==================================================

def get_chat_history(
    db: Session,
    session_id: str
):

    sql = text("""
        SELECT
            role,
            content
        FROM chat_messages
        WHERE session_id = :session_id
        ORDER BY created_at ASC
        LIMIT 20
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

    return "\n".join(
        history
    )


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

    # ------------------------------------------
    # Gemini 응답이 리스트인 경우
    # 문자열로 변환
    # ------------------------------------------

    if isinstance(content, list):

        result = []

        for item in content:

            if isinstance(item, str):
                result.append(item)

            elif isinstance(item, dict):

                text_content = item.get("text")

                if text_content:
                    result.append(text_content)

        content = "".join(result)

    # ------------------------------------------
    # Gemini 응답이 딕셔너리인 경우
    # ------------------------------------------

    elif isinstance(content, dict):

        content = content.get(
            "text",
            str(content)
        )

    # ------------------------------------------
    # 혹시 문자열이 아닌 경우
    # ------------------------------------------

    elif not isinstance(content, str):

        content = str(content)

    # ------------------------------------------
    # DB 저장
    # ------------------------------------------

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
# 3. 경기 조회
# ==================================================

def get_recent_games(
    db: Session
):

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

    rows = db.execute(
        sql
    ).mappings().all()

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

    return "\n".join(
        result
    )


# ==================================================
# 선수 정보
# ==================================================

def get_player_data(
    db: Session
):

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

    rows = db.execute(
        sql
    ).mappings().all()

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

    return "\n".join(
        result
    )


# ==================================================
# 4. 선수 데이터 분석
# ==================================================

def analyze_player_stats(
    db: Session
):

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

    rows = db.execute(
        sql
    ).mappings().all()

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

    return "\n".join(
        result
    )


# ==================================================
# 8. 사용자 정보
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
# 질문 유형 판단
# ==================================================

def classify_question(
    question: str
):

    if any(
        keyword in question
        for keyword in [
            "내 포인트",
            "내 점수",
            "내 등급",
            "내 관심팀",
            "내가 좋아하는 팀",
            "내 예측",
            "내 정보"
        ]
    ):

        return "personal"

    if any(
        keyword in question
        for keyword in [
            "승부예측",
            "승률",
            "누가 이길",
            "누가 이겨",
            "승부",
            "예측",
            "승리 가능성",
            "이길 가능성",
            "경기 예상",
            "경기 전망"
        ]
    ):

        return "prediction"

    if any(
        keyword in question
        for keyword in [
            "분석",
            "통계",
            "기록",
            "타율",
            "홈런",
            "타점",
            "ERA",
            "OPS",
            "WAR",
            "wRC"
        ]
    ):

        return "analysis"

    if any(
        keyword in question
        for keyword in [
            "오늘 경기",
            "경기 일정",
            "경기 결과",
            "경기",
            "팀",
            "선수"
        ]
    ):

        return "database"

    if any(
        keyword in question
        for keyword in [
            "규칙",
            "스트라이크",
            "볼넷",
            "삼진",
            "병살",
            "야구 용어",
            "OPS가 뭐",
            "ERA가 뭐"
        ]
    ):

        return "rag"

    if any(
        keyword in question
        for keyword in [
            "야구",
            "투수",
            "타자",
            "포수",
            "외야수",
            "내야수"
        ]
    ):

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

    # ------------------------------------------
    # 세션이 없으면 생성
    # ------------------------------------------

    if not session_id:

        session_id = create_chat_session(
            db,
            user_id
        )

    # ------------------------------------------
    # 이전 대화
    # ------------------------------------------

    history = get_chat_history(
        db,
        session_id
    )

    # ------------------------------------------
    # 사용자 질문 저장
    # ------------------------------------------

    save_message(
        db=db,
        session_id=session_id,
        role="USER",
        content=question
    )

    # ------------------------------------------
    # 질문 분류
    # ------------------------------------------

    question_type = classify_question(
        question
    )

    context = ""

    generated_sql = None

    # ------------------------------------------
    # 8. 사용자 맞춤
    # ------------------------------------------

    if question_type == "personal":

        if user_id:

            user = get_user_data(
                db,
                user_id
            )

            if user:

                context = f"""
닉네임: {user["nickname"]}
포인트: {user["point"]}
등급: {user["grade"]}
현재 연속 적중: {user["prediction_streak"]}
최대 연속 적중: {user["max_prediction_streak"]}
관심 팀: {user["favorite_team"]}
"""

            else:

                context = "사용자 정보를 찾을 수 없습니다."

        else:

            context = """
현재 사용자가 로그인하지 않았습니다.
개인 정보를 조회할 수 없습니다.
"""

    # ------------------------------------------
    # 5. 승부예측
    # ------------------------------------------

    elif question_type == "prediction":

        try:

            # ==================================================
            # 질문에서 두 팀 찾기
            # ==================================================

            with engine.connect() as conn:
                home_team, away_team = (
                    predictor.find_teams_from_question(
                        conn,
                        question
                    )
                )
            # ==================================================
            # 두 팀을 찾지 못한 경우
            # ==================================================

            if home_team is None or away_team is None:

                context = """

    경기 예측을 요청받았지만

    사용자 질문에서 예측할 두 팀을 찾지 못했습니다.


    사용자에게 예측을 원하는 두 팀의 이름을

    입력해 달라고 안내하세요.

    예:

    "양키스와 레드삭스 중 누가 이길까?"

    "다저스와 파드리스 승부예측 해줘"

    """

            else:
                # ==================================================
                # 머신러닝 경기 예측
                # ==================================================
                prediction = predictor.predict_matchup(
                    home_team_id=home_team["team_id"],
                    away_team_id=away_team["team_id"]
                )
                # ==================================================
                # Gemini에게 전달할 결과
                # ==================================================
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

    위 경기 예측 결과는 BASEBOT의 RandomForest 머신러닝 모델이

    계산한 결과이다.


    사용자에게 답변할 때 모델의 승리 확률이나

    예측 승리팀을 임의로 변경하지 않는다.


    실제 경기 결과를 알고 있는 것처럼 말하지 않는다.


    예측 결과는 머신러닝 모델에 따른 참고용 결과임을

    간단하게 안내할 수 있다.

    """

        except FileNotFoundError as e:

            context = f"""

    경기 예측 모델을 사용할 수 없습니다.


    오류:

    {str(e)}


    사용자에게 현재 경기 예측 모델을 사용할 수 없다고

    간단하게 안내하세요.

    """


        except Exception as e:

            print(

                f"[경기 예측 오류] {e}"

            )

            context = """

    경기 예측을 처리하는 과정에서 오류가 발생했습니다.


    사용자에게 현재 경기 예측을 처리할 수 없다고

    간단하게 안내하세요.

    """

        # 현재는 실제 경기 선택 로직을 추가하기 전 단계

    # ------------------------------------------
    # 4. 데이터 분석
    # ------------------------------------------

    elif question_type == "analysis":

        context = analyze_player_stats(
            db
        )

    # ------------------------------------------
    # 3. DB 조회
    # ------------------------------------------

    elif question_type == "database":

        context = get_recent_games(
            db
        )

        if not context:

            context = get_player_data(
                db
            )

    # ------------------------------------------
    # 7. RAG
    # ------------------------------------------

    elif question_type == "rag":

        documents = search_documents(
            question,
            k=3
        )

        if documents:

            context = "\n\n".join(
                document.page_content
                for document in documents
            )

    # ------------------------------------------
    # 2. 야구 전문 질문
    # ------------------------------------------

    elif question_type == "baseball":

        context = """
사용자는 야구와 관련된 전문적인 질문을 하고 있습니다.

야구 규칙, 경기 방식, 포지션,
선수 기록 등에 대해 정확하게 설명합니다.
"""

    # ------------------------------------------
    # 1. 일반 질문
    # ------------------------------------------

    else:

        context = ""

    # ------------------------------------------
    # Gemini
    # ------------------------------------------

    answer = ask_gemini(
        question=question,
        context=context,
        history=history
    )

    # ------------------------------------------
    # AI 답변 저장
    # ------------------------------------------

    save_message(
        db=db,
        session_id=session_id,
        role="ASSISTANT",
        content=answer,
        generated_sql=generated_sql
    )

    return session_id, answer