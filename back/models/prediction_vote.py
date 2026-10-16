from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class PredictionVote(Base):
    __tablename__ = "prediction_votes"

    __table_args__ = (
        UniqueConstraint(
            "game_id",
            "user_id",
            name="uk_prediction_votes"
        ),
    )

    vote_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    game_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("games.game_id"),
        nullable=False
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.user_id"),
        nullable=False
    )

    selected_team_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("teams.team_id"),
        nullable=False
    )

    bet_point: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("100")
    )

    is_correct: Mapped[bool | None] = mapped_column(
        Boolean,
        nullable=True
    )

    reward_point: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP")
    )