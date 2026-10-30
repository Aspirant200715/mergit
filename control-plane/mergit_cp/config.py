"""Typed configuration. Every value comes from the environment; nothing here is a deployment fact."""

from typing import Annotated

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from mergit_worker.providers import effective_model

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

    planner_model: str
    """The planner's model (HLD D18 is open, so this is a deployment choice, not a code default)."""
    prices_file: str = "prices.toml"
    planner_max_tasks: int = Field(default=8, ge=1, le=32)
    plans_per_hour: int = Field(default=10, ge=1)
    """Planner calls per requester per hour. Each one spends on the model before anything is funded."""
    goal_max_chars: int = Field(default=8000, ge=1)
    repo_hosts: Annotated[list[str], NoDecode] = ["github.com"]
    """Hosts a plan's repository may live on. The worker clones it, so anything else is refused here."""
    max_attempts: int = Field(default=3, ge=1)
    """Agents a requester may list per task: the pick plus the retries (plan O6: at most 3 attempts)."""

    events_token: SecretStr
    """Shared secret sent to the gateway as ``Authorization: Bearer`` (spec/events-v0.md)."""
    chain_events_token: SecretStr
    """Shared secret the gateway must send as ``Authorization: Bearer`` on POST /v0/chain-events.

    spec/events-v0.md names a token for each of the other two legs (``EVENTS_TOKEN`` out,
    ``STORE_WRITE_TOKEN`` for the worker) but not this one; this is the one assumed for gateway to
    orchestrator, to confirm with Yash before go-live rather than leave the endpoint open.
    """
    event_retry_window_s: float = Field(default=600, gt=0)
    event_poll_s: float = Field(default=1.0, gt=0)
    event_timeout_s: float = Field(default=10.0, gt=0)
    outcome_poll_s: float = Field(default=1.0, gt=0)
    """How often finished jobs are checked for a retry, an escalation or plan completion (plan O6)."""

    chain_id: int = BASE_SEPOLIA_CHAIN_ID
    nonce_ttl_s: int = Field(default=600, gt=0)
    session_ttl_s: int = Field(default=12 * 3600, gt=0)
    db_pool_max: int = Field(default=10, gt=0)

    worker_token: SecretStr
    """Shared secret the worker sends as ``Authorization: Bearer`` on POST /v0/internal/progress
    (plan task O7). Not named in spec/events-v0.md, which only covers the orchestrator-gateway leg;
    this is this service's own choice for its one worker-facing endpoint."""
    sse_poll_s: float = Field(default=1.0, gt=0)
    """How often GET /v0/plans/{id}/events re-reads plan and task state from the database. A step the
    worker posts to /v0/internal/progress is relayed to subscribers immediately, not on this timer."""

    @model_validator(mode="after")
    def _planner_model_follows_the_provider(self) -> "Settings":
        # On Groq the planner runs the Groq model, and the start-up price check and the recorded cost must
        # name
        # the model that really answers (mergit_worker/providers.py). Unchanged whenever Anthropic is the
        # provider.
        self.planner_model = effective_model(self.planner_model)
        return self

    @field_validator("cors_origins", "repo_hosts", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value
