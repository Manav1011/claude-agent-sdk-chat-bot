from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.category import CategoryType


class CategoryCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"name": "Groceries", "type": "expense"}]}
    )

    name: str = Field(min_length=1, max_length=50, examples=["Groceries"])
    type: CategoryType = Field(examples=["expense"])


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"name": "Food"}]})

    name: str | None = Field(default=None, min_length=1, max_length=50)
    type: CategoryType | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: CategoryType
    created_at: datetime
