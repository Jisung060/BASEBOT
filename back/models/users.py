from datetime import date, datetime

from sqlalchemy import String, Date, DateTime, Integer, Enum
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    name: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )

    nickname: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    birth_date: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    password: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    gender: Mapped[str] = mapped_column(
        Enum("M", "F", "OTHER"),
        nullable=False
    )

    phone: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False
    )

    email: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False
    )

    point: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )

    grade: Mapped[str] = mapped_column(
        Enum("BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"),
        default="BRONZE",
        nullable=False
    )

    prediction_streak: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )

    max_prediction_streak: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False
    )