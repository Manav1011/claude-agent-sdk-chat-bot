import enum
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CategoryType(str, enum.Enum):
    income = "income"
    expense = "expense"


class Category(Base):
    __tablename__ = "categories"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        Index("uq_categories_user_lower_name", "user_id", text("lower(name)"), unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[CategoryType] = mapped_column(
        Enum(CategoryType, name="category_type", create_constraint=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
