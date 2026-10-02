# from fastapi import FastAPI
#
# from routers.auth import router as auth_router
#
#
# app = FastAPI(
#     title="BaseBot API"
# )
#
#
# app.include_router(auth_router)
#
#
# @app.get("/")
# def root():
#     return {
#         "message": "BaseBot API Server"
#     }

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routers.auth import router as auth_router


app = FastAPI(
    title="BaseBot API"
)


# Frontend 정적 파일 연결
app.mount(
    "/static",
    StaticFiles(directory="../front"),
    name="static"
)


# 로그인 페이지
@app.get("/")
def login_page():
    return FileResponse("../front/pages/login.html")


# 로그인 API
app.include_router(auth_router)
