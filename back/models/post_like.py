from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class PostLike(Base):
    __tablename__ = "post_likes"

    post_like_id: Mapped[int] = mapped_column(
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

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now,
        nullable=False
    )