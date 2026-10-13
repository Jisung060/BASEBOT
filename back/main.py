from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from database.db_connection import engine
from database.orm import Base

from models.user import User
from models.team import Team
from models.comment import Comment
from models.comment_like import CommentLike
from models.post_like import PostLike
from routers.user import router as user_router
from routers.chat import router as chat_router
from routers.auth import router as auth_router
from routers.my_posts import router as my_posts_router
from routers import favorite_team
from routers import home
from routers.my_comments import router as my_comments_router

from routers.community import router as community_router


from routers import players, teams, games, predictions, rankings
from routers.news import router as news_router # 뉴스추가


app = FastAPI(
    title="BASEBOT API"
)


# DB 테이블 생성
Base.metadata.create_all(
    bind=engine
)

# CORS
app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500"
    ],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)

# Router
app.include_router(my_comments_router)
app.include_router(home.router)
app.include_router(favorite_team.router)
app.include_router(auth_router)
app.include_router(user_router)
app.include_router(community_router)
app.include_router(my_posts_router)
app.include_router(players.router)
app.include_router(teams.router)
app.include_router(games.router)
app.include_router(predictions.router)
app.include_router(chat_router)
app.include_router(rankings.router)

app.include_router(news_router) # 뉴스


# 정적 파일
# CSS
app.mount(
    "/css",
    StaticFiles(directory="../front/css"),
    name="css"
)


# JS
app.mount(
    "/js",
    StaticFiles(directory="../front/js"),
    name="js"
)


# Components
app.mount(
    "/components",
    StaticFiles(directory="../front/components"),
    name="components"
)


# Assets
app.mount(
    "/assets",
    StaticFiles(directory="../front/assets"),
    name="assets"
)

import os
# 프로젝트 back 폴더 기준으로 업로드 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
COMMUNITY_UPLOAD_DIR = os.path.join(
    UPLOAD_DIR,
    "community"
)

# 업로드 폴더가 없으면 자동 생성
os.makedirs(COMMUNITY_UPLOAD_DIR, exist_ok=True)

# 업로드 이미지 접근 경로 연결
app.mount(
    "/uploads",
    StaticFiles(directory=UPLOAD_DIR),
    name="uploads"
)


# 메인 페이지
@app.get("/")
def root():

    return FileResponse(
        "../front/pages/main.html"
    )

# HTML 페이지

# HTML 페이지
@app.get("/{page_path:path}.html")
def pages(page_path: str):

    # HTML 파일 경로
    pages_dir = (
        Path(__file__).resolve().parent.parent
        / "front"
        / "pages"
    ).resolve()

    file_path = (
        pages_dir / f"{page_path}.html"
    ).resolve()

    # pages 폴더 바깥의 파일 접근 차단
    if not file_path.is_relative_to(pages_dir):
        raise HTTPException(
            status_code=404,
            detail="페이지를 찾을 수 없습니다."
        )

    # 페이지가 존재하지 않는 경우
    if not file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="페이지를 찾을 수 없습니다."
        )

    return FileResponse(file_path)
