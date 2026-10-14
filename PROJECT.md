# BASEBOT 프로젝트 구조 및 아키텍처 가이드

**BASEBOT**은 MLB(메이저리그 야구) 데이터 조회, 머신러닝 기반 경기 승부 예측, Google Gemini + RAG 기반 야구 전문 AI 챗봇, 실시간 야구 뉴스 크롤링, 커뮤니티 및 관리자 대시보드를 제공하는 야구 종합 플랫폼입니다.

---

## 1. 주요 기술 스택

| 영역 | 기술 및 라이브러리 | 설명 |
| :--- | :--- | :--- |
| **Backend Framework** | Python, FastAPI, Uvicorn | 비동기 고성능 REST API 및 정적 파일 서빙 |
| **Database & ORM** | MySQL (`basebot_db`), SQLite (`mlb_news.db`), SQLAlchemy, PyMySQL | 유저/커뮤니티/통계 데이터 관리 및 뉴스 캐시 |
| **인증 / 보안** | JWT (`pyjwt`), `pwdlib` (bcrypt), `python-multipart` | 토큰 기반 사용자 인증 및 패스워드 암호화 |
| **데이터 수집 (ETL)** | `pybaseball`, MLB Stats API (`requests`), `curl_cffi`, `pandas` | 경기 일정, 박스스코어, 선수 통계, Savant 지표 수집 |
| **머신러닝 (ML)** | `scikit-learn`, `lightgbm`, `joblib` | 과거 전적 및 선수 지표 기반 경기 승부 예측 모델 |
| **AI / RAG** | Google Gemini (`gemini-3.1-flash-lite`), LangChain, ChromaDB | 야구 지식 RAG 및 실시간 DB 조회를 결합한 야구 전문 챗봇 |
| **Frontend** | Vanilla HTML5, CSS3, JavaScript | SPA 스타일 동적 컴포넌트(`fetch`) 기반 화면 구성 |

---

## 2. 전체 디렉터리 트리

```text
BASEBOT/
├── back/                      # 백엔드 API 서버, AI/ML 모델, 데이터 수집 파이프라인
│   ├── auth/                  # JWT 토큰 발급, 인증 의존성(Dependencies), 비밀번호 해시
│   ├── chroma_db/             # 야구 지식 RAG 벡터 데이터베이스 (ChromaDB)
│   ├── database/              # MySQL 연결 설정 (db_connection.py) 및 SQLite (mlb_news.db)
│   ├── ml/                    # 승부 예측 모델 학습 스크립트 및 pkl 모델 가중치 파일
│   ├── models/                # SQLAlchemy ORM 모델 (유저, 커뮤니티, 댓글, 채팅 등)
│   ├── rag_data/              # RAG 인덱싱용 야구 도메인 텍스트 (규칙, 통계, 전술 등)
│   ├── routers/               # FastAPI 엔드포인트 라우터 (사용자, 경기, AI, 관리자)
│   ├── schemas/               # Pydantic DTO 스키마
│   ├── scripts/               # MLB 데이터 수집(ETL) 및 RAG 문서 인덱싱 스크립트
│   ├── services/              # AI 챗봇(Gemini), 승부예측(LightGBM), RAG 검색 서비스
│   ├── uploads/               # 커뮤니티 이미지 등 정적 미디어 업로드 경로
│   ├── utils/                 # 백엔드 공통 유틸리티
│   ├── check_db.py            # DB 연결 및 상태 점검 스크립트
│   ├── main.py                # FastAPI 진입점, CORS, 정적 라우팅 및 HTML 서빙
│   └── requirements.txt       # 백엔드 파이썬 의존성 패키지 목록
│
├── front/                     # 프론트엔드 정적 웹 리소스
│   ├── assets/                # 이미지, 팀 로고, 아이콘 등 정적 자원
│   ├── components/            # 공통 재사용 UI 컴포넌트 (header, footer, sidebar 등)
│   ├── css/                   # 화면별 CSS 스타일시트 (사용자/관리자)
│   ├── js/                    # 화면별 비즈니스 로직 및 API 연동 JS
│   └── pages/                 # HTML 페이지 (메인, 경기, 선수, 커뮤니티, 마이페이지 등)
│       └── admin/             # 관리자 전용 대시보드 및 운영 페이지
│
├── status                     # Git 작업 히스토리 및 개발 로그
├── README.txt                 # Git 설정 및 데이터 수집 스크립트 실행 가이드
└── PROJECT.md                 # 프로젝트 전체 구조 및 기술 문서 (본 문서)
```

---

## 3. 백엔드 (`back/`) 상세 구조

### ① API 라우팅 (`back/routers/`)
* **야구 데이터 & 통계**:
  * `home.py`: 메인 대시보드용 요약 데이터 (오늘의 경기, 최신 글, 랭킹)
  * `games.py`: 날짜별 경기 일정 및 박스스코어 상세 조회
  * `players.py`: 선수 목록, 프로필, 타자/투수 세부 통계 및 Baseball Savant 지표
  * `teams.py`: 30개 MLB 구단 정보 및 팀별 로스터/스탯 조회
  * `rankings.py`: 리그 및 지구(Division)별 구단 순위, 타자/투수 랭킹
  * `news.py`: MLB 뉴스 크롤링, AI 기사 요약 및 조회
* **AI & 예측**:
  * `chat.py`: Gemini 기반 야구 전문 챗봇 대화 생성 및 세션 관리
  * `predictions.py`: LightGBM 모델 기반 경기 승패 확률 제공 및 사용자 승부예측 참여/결과 내역
* **사용자 & 커뮤니티**:
  * `auth.py`, `user.py`: 회원가입, 로그인(JWT), 회원정보 수정, 아이디/비밀번호 찾기
  * `favorite_team.py`: 사용자 선호 구단 설정 및 맞춤 정보 연동
  * `community.py`: 자유/팬 커뮤니티 게시글 CRUD, 이미지 업로드, 댓글, 좋아요, 북마크, 신고
  * `my_posts.py`, `my_comments.py`: 내가 쓴 글 및 댓글 모아보기
* **관리자 (Admin)**:
  * `admin_dashboard.py`: 일별 가입자, 활동량, 서버 상태 통계
  * `admin_users.py`: 회원 목록 조회, 권한 부여, 유저 정지 관리
  * `admin_community.py`: 신고된 게시글 및 커뮤니티 관리

### ② 서비스 계층 (`back/services/`)
* `chat_service.py`: Google Gemini(`gemini-3.1-flash-lite`)와 LangChain 연동. 사용자 질의 분석 후 RAG 문서 및 MySQL 스탯을 결합하여 고품질 야구 전문 답변 생성.
* `prediction_service.py`: `back/ml/game_prediction_model.pkl` 모델을 활용하여 선발투수, 최근 전적, 득/실점 마진 등 피처 기반 경기 승률 산출.
* `rag_service.py`: `back/chroma_db` 벡터 저장소를 검색해 관련 야구 지식 문서 청크 반환.

### ③ 데이터 수집 & ML 파이프라인 (`back/scripts/`, `back/ml/`, `back/rag_data/`)
* **MLB 데이터 수집 스크립트**:
  * `seed_teams.py`: MLB 30개 팀 메타데이터 초기 세팅
  * `collector_games.py`, `collector_boxscores.py`: 지정 시즌/기간 경기 일정 및 박스스코어 수집
  * `collector_batters_integrated.py`, `collector_pitchers_integrated.py`: 타자/투수 상세 스탯 수집
  * `collector_players_meta.py`, `collector_savant_value_repair.py`: 선수 프로필 및 Baseball Savant 백분위 지표 수집
* **RAG 인덱싱**:
  * `rag_data/*.txt`: 야구 규칙, 용어, 타격/투구/수비 기술, 통계 지표, FAQ 등 전문 지식 텍스트
  * `rag_ingest.py`: 해당 텍스트들을 청크 분할 및 임베딩하여 ChromaDB에 적재
* **머신러닝**:
  * `train_prediction_model.py`: 경기 데이터를 학습하여 승부 예측 모델(`game_prediction_model.pkl`) 생성

### ④ 데이터베이스 및 ORM (`back/models/`, `back/database/`)
* `database/db_connection.py`: MySQL(`mysql+pymysql://basebot:basebot@localhost:3306/basebot_db`) 연결 세션 풀 관리.
* `models/`:
  * `user.py`: 사용자 계정 (이메일, 닉네임, 권한, 선호팀 등)
  * `team.py`: 구단 정보
  * `community.py`, `community_image.py`, `comment.py`: 커뮤니티 게시글, 사진, 댓글
  * `post_like.py`, `comment_like.py`, `post_scrap.py`, `post_report.py`: 반응 및 신고 엔티티
  * `chat.py`: AI 챗봇 세션(`chat_sessions`) 및 메시지 이력(`chat_messages`)

---

## 4. 프론트엔드 (`front/`) 상세 구조

FastAPI가 `front/` 하위 정적 자원을 직접 호스팅하며, 브라우저에서 Vanilla JS로 비동기 통신합니다.

### ① 공통 컴포넌트 (`front/components/`)
* `header.html`, `footer.html`: 상단 네비게이션(로그인 상태 감지, 선호팀 표시) 및 푸터
* `admin-sidebar.html`, `admin-topbar.html`, `admin-footer.html`: 관리자 전용 네비게이션
* `mypage-sidebar.html`, `auth-sidebar.html`: 마이페이지 및 인증 서브 메뉴

### ② 주요 페이지 (`front/pages/`)
* **메인 & 데이터**:
  * `main.html`: 메인 대시보드 (실시간 경기 스코어보드, 주요 뉴스, 랭킹 요약)
  * `game.html`, `game-detail.html`: 일자별 경기 목록, 이닝별 스코어, 라인업 및 박스스코어
  * `teams.html`, `team-detail.html`: 30개 팀 목록, 로스터, 시즌 성적
  * `player-detail.html`: 선수 통계 및 Baseball Savant 스타일의 퍼센타일 막대 그래프
  * `rankings.html`: 팀/선수 순위표
  * `mlb_news.html`: 실시간 크롤링된 야구 뉴스 목록 및 본문 읽기
* **AI & 예측**:
  * `prediction.html`, `prediction-history.html`: AI 승부 예측 승률 확인, 승부예측 투표 및 참여 이력
* **커뮤니티 & 마이페이지**:
  * `community.html`, `community-view.html`, `community-write.html`, `community-edit.html`: 게시글 목록/상세/작성/수정
  * `mypage.html`, `my-posts.html`, `my-comments.html`, `my-scraps.html`, `my-reports.html`: 내 활동 관리
  * `login.html`, `signup.html`, `find-id.html`, `find-password.html`: 회원 인증
* **관리자 전용 (`front/pages/admin/`)**:
  * `dashboard.html`: 전체 통계 요약
  * `users.html`: 회원 관리 (권한 변경, 강제 탈퇴/정지)
  * `community.html`: 신고 글 관리 및 게시글 숨김 처리
  * `chatbot.html`: 챗봇 로그 및 응답 현황 모니터링
  * `settings.html`, `system-status.html`: 시스템 운영 환경 설정

---

## 5. 핵심 동작 워크플로우

```mermaid
flowchart TD
    User([사용자 브라우저]) <-->|HTML / JS / CSS 요청| FastAPI[FastAPI App (main.py)]
    User <-->|REST API (JSON)| Routers[Routers (api/*)]

    subgraph Backend Services
        Routers <--> DB[(MySQL: basebot_db)]
        Routers <--> Cache[(SQLite: mlb_news.db)]
        Routers --> ChatService[AI Chat Service]
        Routers --> PredService[Prediction Service]
        
        ChatService <--> Chroma[(ChromaDB: RAG)]
        ChatService <--> Gemini[Google Gemini API]
        ChatService <--> DB
        
        PredService <--> MLModel[LightGBM Model (.pkl)]
        PredService <--> DB
    end

    subgraph Data Pipeline
        MLBAPI[MLB Stats API / PyBaseball] --> Scripts[Collector Scripts]
        Scripts --> DB
        RAGFiles[rag_data/*.txt] --> RAGIngest[rag_ingest.py] --> Chroma
        DB --> TrainML[train_prediction_model.py] --> MLModel
    end
```

1. **웹 브라우저 렌더링**: 사용자가 접속하면 FastAPI가 HTML과 정적 리소스를 제공하며, 페이지 로드 후 JS의 `fetch()`를 통해 `components/header.html` 등을 결합하고 API 데이터를 수신해 DOM을 동적으로 채웁니다.
2. **AI 챗봇 파이프라인**: 사용자 질문 발생 시 `chat_service.py`가 의도를 분류하고, ChromaDB 벡터 검색 결과와 MySQL의 최신 통계(선수/경기/팀)를 문맥(Context)으로 조합하여 Gemini에게 전달한 뒤 한국어로 정제된 답변을 사용자에게 반환합니다.
3. **승부 예측 파이프라인**: 경기 일정이 조회되면 선발 투수 지표, 최근 전적, 상대 전적 등의 특성(Feature)을 생성하여 사전 학습된 LightGBM 모델을 통해 홈/원정 승리 확률을 산출하고 제공합니다.
