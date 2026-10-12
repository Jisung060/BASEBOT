from datetime import datetime

from sqlalchemy import BigInteger, String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class CommunityImage(Base):
    __tablename__ = "community_images"

    image_id: Mapped[int] = mapped_column(
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

    original_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    stored_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    file_path: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True
    )

    file_size: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now,
        nullable=False
    )