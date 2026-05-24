from src.filter import is_allowed


def process_events(events: list) -> list:
    """Process a list of events, marking each as processed or skipped."""
    results = []
    for event in events:
        if is_allowed(event["type"]):
            results.append({**event, "status": "processed"})
        else:
            results.append({**event, "status": "skipped"})
    return results


def count_processed(events: list) -> int:
    return sum(1 for e in process_events(events) if e["status"] == "processed")
