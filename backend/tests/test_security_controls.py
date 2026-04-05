from app.security_controls import LoginRateLimiter, build_login_rate_limit_key


def test_login_rate_limiter_blocks_after_window_threshold():
    limiter = LoginRateLimiter(max_attempts=3, window_seconds=60)
    key = build_login_rate_limit_key("security", "127.0.0.1")
    now = 1_000.0

    assert limiter.assess(key, now=now).allowed is True
    limiter.record_failure(key, now=now)
    limiter.record_failure(key, now=now + 5)
    limiter.record_failure(key, now=now + 10)

    decision = limiter.assess(key, now=now + 15)
    assert decision.allowed is False
    assert decision.retry_after_seconds >= 45


def test_login_rate_limiter_resets_after_success_or_window_expiry():
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=30)
    key = build_login_rate_limit_key("security", "127.0.0.1")
    now = 2_000.0

    limiter.record_failure(key, now=now)
    limiter.record_failure(key, now=now + 2)
    assert limiter.assess(key, now=now + 3).allowed is False

    limiter.reset(key)
    assert limiter.assess(key, now=now + 3).allowed is True

    limiter.record_failure(key, now=now + 4)
    assert limiter.assess(key, now=now + 40).allowed is True
