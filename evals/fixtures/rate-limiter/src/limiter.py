import time


class RateLimiter:
    """Sliding-window rate limiter. Should enforce limits per user independently."""

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        # BUG: single global list instead of per-user dict
        self._log: list = []

    def is_allowed(self, user_id: str) -> bool:
        now = time.time()
        window_start = now - self.window
        # Prune expired entries
        self._log = [e for e in self._log if e["time"] > window_start]
        # BUG: counts requests from ALL users, not just this user
        if len(self._log) >= self.max_requests:
            return False
        self._log.append({"user": user_id, "time": now})
        return True
