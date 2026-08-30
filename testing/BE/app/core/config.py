from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, read from environment / .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://finance:finance@localhost:5432/finance"
    SECRET_KEY: str = "change-me-in-production"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:5175"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ENV: str = "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
