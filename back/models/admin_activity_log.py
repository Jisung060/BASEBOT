from sqlalchemy import (
    BigInteger,
    Column,
    String,
    Text,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    text,
)

from database.orm import Base


class AdminActivityLog(Base):
    __tablename__ = "admin_activity_logs"

    log_id = Column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )

    admin_id = Column(
        BigInteger,
        ForeignKey("users.user_id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
    )

    admin_username = Column(String(50), nullable=False)

    action_type = Column(String(50), nullable=False)
    action_detail = Column(String(100), nullable=False)

    target_type = Column(String(50), nullable=True)
    target_id = Column(String(100), nullable=True)
    target_name = Column(String(200), nullable=True)

    description = Column(Text, nullable=False)

    result = Column(
        Enum("SUCCESS", "FAILURE"),
        nullable=False,
    )

    error_message = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("idx_admin_logs_admin", "admin_id"),
        Index("idx_admin_logs_action", "action_type"),
        Index("idx_admin_logs_result", "result"),
        Index("idx_admin_logs_created", "created_at"),
    )