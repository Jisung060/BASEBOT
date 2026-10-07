from datetime import datetime

from sqlalchemy import BigInteger, String, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    session_id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True
    )

    user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True
    )

    title: Mapped[str] = mapped_column(
        String(100),
        default="새로운 대화"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    message_id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"),
        nullable=False
    )

    role: Mapped[str] = mapped_column(
        Enum("USER", "ASSISTANT"),
        nullable=False
    )

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False
    )

    generated_sql: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.now
    )