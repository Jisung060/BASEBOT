from datetime import datetime
from sqlite3.dbapi2 import Date

from pyarrow.lib import DataType
from sqlalchemy import BigInteger, String, Text, DateTime, Enum, ForeignKey

from sqlalchemy.orm import Mapped, mapped_column

from database.orm import Base

class ChatSession(Base):
    __tablename__ = "chat_session"

    session_id: Mapped[int] = mapped_column(
        String(36),
        primary_key=True
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("user.user_id", ondelete="CASCADE"),
        nullable=False
    )

    title: Mapped[Text] = mapped_column(
        String(100),
        default="새로운 대화"
    )

    created_at: Mapped[DateTime] = mapped_column(
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

    session_id: Mapped[int] = mapped_column(
        String(36),
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"),
        nullable=False
    )

    role: Mapped[Enum] = mapped_column(
        Enum("USER", "ASSISTANT"),
        nullable=False
    )

    content: Mapped[Text] = mapped_column(
        Text,
        nullable=False
    )

    generated_sql: Mapped[str | None] = mapped_column(
        Text,
        nullable=True
    )

    created_at: Mapped[DateTime] = mapped_column(
        DateTime,
        default=datetime.now
    )
