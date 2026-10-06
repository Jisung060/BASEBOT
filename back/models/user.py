from datetime import datetime

from sqlalchemy import BigInteger, String, Integer, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
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

    nickname: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    email: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False
    )

    favorite_team_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "teams.team_id",
            onupdate="CASCADE",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    role: Mapped[str] = mapped_column(
        Enum("USER", "ADMIN"),
        default="USER",
        nullable=False
    )

    point: Mapped[int] = mapped_column(
        Integer,
        default=1000,
        nullable=False
    )

    grade: Mapped[str] = mapped_column(
        Enum(
            "BRONZE",
            "SILVER",
            "GOLD",
            "PLATINUM",
            "DIAMOND"
        ),
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
        default=datetime.now,
        nullable=False
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now,
        onupdate=datetime.now,
        nullable=False
    )