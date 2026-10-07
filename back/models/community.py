from datetime import datetime

from sqlalchemy import BigInteger, String, Integer, DateTime, Enum, ForeignKey
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class CommunityPost(Base):
    __tablename__ = "community_posts"

    post_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "users.user_id",
            onupdate="CASCADE",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    category: Mapped[str] = mapped_column(
        Enum(
            "GENERAL",
            "ANALYSIS",
            "GAME_THREAD",
            "NEWS"
        ),
        nullable=False
    )

    related_team_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "teams.team_id",
            onupdate="CASCADE",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False
    )

    content: Mapped[str] = mapped_column(
        LONGTEXT,
        nullable=False
    )

    view_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )

    like_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False
    )

    comment_count: Mapped[int] = mapped_column(
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