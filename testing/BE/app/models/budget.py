from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.category import Category


class Budget(Base):
    __tablename__ = "budgets"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint("year >= 1 AND year <= 2099", name="ck_budgets_year_range"),
        CheckConstraint("month >= 1 AND month <= 12", name="ck_budgets_month_range"),
        CheckConstraint("amount > 0", name="ck_budgets_amount_positive"),
        UniqueConstraint("user_id", "category_id", "year", "month", name="uq_budgets_user_cat_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    category_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False
    )
    year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[Category] = relationship(lazy="selectin")
