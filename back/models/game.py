from datetime import date, time, datetime

from sqlalchemy import (
    BigInteger,
    Integer,
    Date,
    Time,
    String,
    Enum,
    DateTime,
    JSON,
    ForeignKey,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class Game(Base):
    __tablename__ = "games"

    game_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True
    )

    home_team_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("teams.team_id"),
        nullable=False
    )

    away_team_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("teams.team_id"),
        nullable=False
    )

    game_date: Mapped[date] = mapped_column(
        Date,
        nullable=False
    )

    game_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True
    )

    stadium: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True
    )

    home_score: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0")
    )

    away_score: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0")
    )

    winning_team_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("teams.team_id"),
        nullable=True
    )

    status: Mapped[str] = mapped_column(
        Enum("SCHEDULED", "IN_PROGRESS", "FINAL", "CANCELLED"),
        nullable=False,
        server_default=text("'SCHEDULED'")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP")
    )

    linescore: Mapped[dict | list | None] = mapped_column(
        JSON,
        nullable=True
    )