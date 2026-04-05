from __future__ import annotations

import math
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
]

DEFAULT_SECURITY_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@dataclass(frozen=True)
class SecuritySettings:
    allowed_origins: list[str]
    login_rate_limit_attempts: int
    login_rate_limit_window_seconds: int
    security_headers: dict[str, str]


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int
    remaining_attempts: int


class LoginRateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max(1, max_attempts)
        self.window_seconds = max(1, window_seconds)
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def assess(self, key: str, *, now: float | None = None) -> RateLimitDecision:
        current = time.monotonic() if now is None else now
        attempts = self._prune(key, current)
        remaining = max(self.max_attempts - len(attempts), 0)
        if len(attempts) >= self.max_attempts:
            retry_after = max(1, math.ceil(self.window_seconds - (current - attempts[0])))
            return RateLimitDecision(
                allowed=False,
                retry_after_seconds=retry_after,
                remaining_attempts=0,
            )
        return RateLimitDecision(
            allowed=True,
            retry_after_seconds=0,
            remaining_attempts=remaining,
        )

    def record_failure(self, key: str, *, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        attempts = self._prune(key, current)
        attempts.append(current)

    def reset(self, key: str) -> None:
        self._attempts.pop(key, None)

    def clear(self) -> None:
        self._attempts.clear()

    def _prune(self, key: str, current: float) -> deque[float]:
        attempts = self._attempts[key]
        while attempts and (current - attempts[0]) >= self.window_seconds:
            attempts.popleft()
        if not attempts:
            self._attempts.pop(key, None)
            return self._attempts[key]
        return attempts


def load_security_settings() -> SecuritySettings:
    return SecuritySettings(
        allowed_origins=_parse_csv_env("INTEGRITY_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS),
        login_rate_limit_attempts=_parse_int_env("INTEGRITY_LOGIN_RATE_LIMIT_ATTEMPTS", 5),
        login_rate_limit_window_seconds=_parse_int_env(
            "INTEGRITY_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
            300,
        ),
        security_headers=DEFAULT_SECURITY_HEADERS.copy(),
    )


def build_login_rate_limit_key(username: str, client_ip: str | None) -> str:
    normalized_ip = (client_ip or "unknown").strip().lower()
    normalized_username = username.strip().lower()
    return f"{normalized_ip}:{normalized_username}"


def _parse_csv_env(name: str, default: list[str]) -> list[str]:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return list(default)
    values = [value.strip() for value in raw_value.split(",") if value.strip()]
    return values or list(default)


def _parse_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        return max(1, int(raw_value))
    except ValueError:
        return default
