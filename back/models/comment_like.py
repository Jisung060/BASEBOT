from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class CommentLike(Base):
    __tablename__ = "comment_likes"

    comment_like_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    comment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "comments.comment_id",
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

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now,
        nullable=False
    )