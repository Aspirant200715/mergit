"""Typed configuration. Every value comes from the environment; nothing here is a deployment fact."""

from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_SEPOLIA_CHAIN_ID = 84532


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    app_domain: str
    """The SIWE domain the web app signs for, e.g. app.mergit.site. Messages for any other domain fail."""
    session_secret: SecretStr = Field(min_length=32)
    gateway_url: str
    store_url: str
    agents_file: str
    """deployments/agents.json from the contracts deployment: agent ids, operators, runtime keys."""
    agents_config: str = "agents.toml"
    """Model and system prompt per agent name."""
    cors_origins: Annotated[list[str], NoDecode] = []

    chain_id: int = BASE_SEPOLIA_CHAIN_ID
    nonce_ttl_s: int = Field(default=600, gt=0)
    session_ttl_s: int = Field(default=12 * 3600, gt=0)
    db_pool_max: int = Field(default=10, gt=0)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value
