from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# basebot_db 설정
DB_USER = "basebot"
DB_PASS = "basebot"   # 본인 MySQL 비밀번호
DB_HOST = "localhost"
DB_PORT = "3306"
DB_NAME = "basebot_db"

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# FastAPI 의존성 주입(Dependency)용 함수
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()