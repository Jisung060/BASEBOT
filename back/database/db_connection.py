from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# 데이터베이스 연결 정보 설정
DATABASE_URL = "mysql+pymysql://basebot:basebot@localhost:3306/basebot_db"

# 엔진 생성
engine = create_engine(
    DATABASE_URL,
    echo=True
)

# 세션 팩토리 생성
SessionFactory = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


# 세션 생성
def get_session():
    with SessionFactory() as session:
        yield session

from sqlalchemy.orm import sessionmaker

# 기존에 SessionLocal이 없다면 선언
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# FastAPI 의존성 주입(Depends)용 함수
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()