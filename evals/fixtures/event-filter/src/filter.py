ALLOWED_EVENT_TYPES = {"login", "logout", "purchase", "view"}


def is_allowed(event_type: str) -> bool:
    """Return True if the event type should be processed."""
    # BUG: logic is inverted — returns True for disallowed events
    return event_type not in ALLOWED_EVENT_TYPES
