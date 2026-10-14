
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    String,
    func
)
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class PostReport(Base):
    __tablename__ = "post_reports"

    report_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    post_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "community_posts.post_id",
            onupdate="CASCADE",
            ondelete="SET NULL"
        ),
        nullable=True
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

    reason: Mapped[str] = mapped_column(
        Enum(
            "ABUSE",
            "AD",
            "SPAM",
            "INAPPROPRIATE",
            "ETC",
            name="post_report_reason"
        ),
        nullable=False
    )

    content: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True
    )

    status: Mapped[str] = mapped_column(
        Enum(
            "PENDING",
            "REVIEWED",
            "REJECTED",
            "ACCEPTED",
            name="post_report_status"
        ),
        nullable=False,
        server_default="PENDING"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp()
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True
    )
