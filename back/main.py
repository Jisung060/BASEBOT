from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from database.db_connection import engine
from database.orm import Base

from models.user import User
from models.team import Team
from routers.chat import router as chat_router
from routers.auth import router as auth_router

from routers.community import router as community_router

from routers import players, teams, games, predictions
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
app.include_router(auth_router)
app.include_router(community_router)
app.include_router(players.router)
app.include_router(teams.router)
app.include_router(games.router)
app.include_router(predictions.router)
app.include_router(chat_router)
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

# 메인 페이지
@app.get("/")
def root():

    return FileResponse(
        "../front/pages/main.html"
    )

# HTML 페이지
@app.get("/{page_name}.html")
def pages(page_name: str):

    file_path = Path(
        "../front/pages"
    ) / f"{page_name}.html"


    # 페이지가 존재하지 않는 경우
    if not file_path.exists():

        raise HTTPException(
            status_code=404,
            detail="페이지를 찾을 수 없습니다."
        )


    return FileResponse(
        file_path
    )