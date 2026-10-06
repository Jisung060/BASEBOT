from datetime import datetime

from sqlalchemy import BigInteger, String, Enum, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base

class Team(Base):
    __tablename__ = "teams"

    team_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True
    )

    team_name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False
    )

    team_code: Mapped[str] = mapped_column(
        String(10),
        unique=True,
        nullable=False
    )

    league: Mapped[str] = mapped_column(
        Enum("AL", "NL"),
        nullable=False
    )

    division: Mapped[str] = mapped_column(
        Enum("East", "Central", "West"),
        nullable=False
    )

    city: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True
    )

    stadium: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True
    )

    logo_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now,
        nullable=False
    )