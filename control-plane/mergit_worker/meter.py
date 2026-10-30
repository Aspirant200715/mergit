"""Step cost metering. Token counts come from the provider's usage report, prices from prices.toml."""

from __future__ import annotations

import json
import tomllib
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from .config import ConfigError

_MILLION = Decimal(1_000_000)


@dataclass(frozen=True, slots=True)
class Price:
    input_per_mtok: Decimal
    output_per_mtok: Decimal
    # Prompt-cache prices. None when the table has none: a call that reports cache tokens then fails
    # instead of being priced as if the cache were free.
    cache_read_per_mtok: Decimal | None = None
    cache_write_per_mtok: Decimal | None = None


def _optional_price(table: dict[str, object], key: str) -> Decimal | None:
    value = table.get(key)
    return None if value is None else Decimal(str(value))


@dataclass(frozen=True, slots=True)
class Cost:
    """The step cost object of spec/receipt-v0.md."""

    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: int = 0
    wall_ms: int = 0
    usd_micros: int = 0

    def to_json(self) -> str:
        return json.dumps(
            {
                "model": self.model,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "tool_calls": self.tool_calls,
                "wall_ms": self.wall_ms,
                "usd_micros": self.usd_micros,
            }
        )

    def __add__(self, other: Cost) -> Cost:
        return Cost(
            model=None,
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            tool_calls=self.tool_calls + other.tool_calls,
            wall_ms=self.wall_ms + other.wall_ms,
            usd_micros=self.usd_micros + other.usd_micros,
        )


class PriceTable:
    def __init__(self, prices: dict[str, Price]) -> None:
        self._prices = prices

    @classmethod
    def load(cls, path: Path) -> PriceTable:
        try:
            raw = tomllib.loads(path.read_text())
            models = raw["models"]
            return cls(
                {
                    name: Price(
                        Decimal(str(p["input_per_mtok"])),
                        Decimal(str(p["output_per_mtok"])),
                        _optional_price(p, "cache_read_per_mtok"),
                        _optional_price(p, "cache_write_per_mtok"),
                    )
                    for name, p in models.items()
                }
            )
        except (OSError, KeyError, TypeError, ValueError) as exc:
            raise ConfigError(f"cannot read price table {path}: {exc}") from exc

    def price(self, model: str) -> Price:
        """The list price for a model, or `ConfigError` if it has none. Checking this before a job is
        claimed, or before a call, is free and catches a bad deploy before it pays for a call whose
        receipt could never carry a real cost."""
        price = self._prices.get(model)
        if price is None:
            raise ConfigError(f"no price for model {model!r} in the price table")
        return price

    def model_call_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        wall_ms: int,
        *,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> Cost:
        """Cost of one model call in micro-USD, rounded half up. An unpriced model is an error:
        a receipt must not carry a guessed cost. ``input_tokens`` excludes cached tokens, which the
        provider reports separately and prices differently."""
        price = self.price(model)
        usd = Decimal(input_tokens) * price.input_per_mtok + Decimal(output_tokens) * price.output_per_mtok
        for tokens, rate, name in (
            (cache_read_tokens, price.cache_read_per_mtok, "cache_read_per_mtok"),
            (cache_write_tokens, price.cache_write_per_mtok, "cache_write_per_mtok"),
        ):
            if tokens:
                if rate is None:
                    raise ConfigError(f"model {model!r} reported cached tokens but has no {name}")
                usd += Decimal(tokens) * rate
        usd /= _MILLION
        micros = int((usd * _MILLION).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        return Cost(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            wall_ms=wall_ms,
            usd_micros=micros,
        )


def tool_cost(wall_ms: int) -> Cost:
    """Cost of a tool or command step: one call, wall clock, no model and no token spend."""
    return Cost(tool_calls=1, wall_ms=wall_ms)
