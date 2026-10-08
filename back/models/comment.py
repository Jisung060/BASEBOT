from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class Comment(Base):
    __tablename__ = "comments"

    comment_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    post_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "community_posts.post_id",
            onupdate="CASCADE",
            ondelete="CASCADE"
        ),
        nullable=False
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

    parent_comment_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "comments.comment_id",
            onupdate="CASCADE",
            ondelete="CASCADE"
        ),
        nullable=True
    )

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )

    like_count: Mapped[int] = mapped_column(
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