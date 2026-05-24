import time
from src.limiter import RateLimiter


def test_basic_limit():
    limiter = RateLimiter(max_requests=2, window_seconds=60)
    assert limiter.is_allowed("alice") is True
    assert limiter.is_allowed("alice") is True
    assert limiter.is_allowed("alice") is False


def test_per_user_isolation():
    limiter = RateLimiter(max_requests=2, window_seconds=60)
    assert limiter.is_allowed("alice") is True
    assert limiter.is_allowed("alice") is True
    assert limiter.is_allowed("alice") is False
    # Bob's limit must be independent of Alice's
    assert limiter.is_allowed("bob") is True
    assert limiter.is_allowed("bob") is True
    assert limiter.is_allowed("bob") is False


def test_window_expiry():
    limiter = RateLimiter(max_requests=1, window_seconds=0.05)
    assert limiter.is_allowed("carol") is True
    assert limiter.is_allowed("carol") is False
    time.sleep(0.1)
    assert limiter.is_allowed("carol") is True
