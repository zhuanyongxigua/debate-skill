from src.processor import process_events, count_processed


def test_allowed_events_are_processed():
    events = [{"id": 1, "type": "login"}, {"id": 2, "type": "purchase"}]
    results = process_events(events)
    assert all(r["status"] == "processed" for r in results)


def test_disallowed_events_are_skipped():
    events = [{"id": 1, "type": "spam"}, {"id": 2, "type": "bot_crawl"}]
    results = process_events(events)
    assert all(r["status"] == "skipped" for r in results)


def test_mixed_events():
    events = [
        {"id": 1, "type": "login"},
        {"id": 2, "type": "spam"},
        {"id": 3, "type": "purchase"},
        {"id": 4, "type": "unknown"},
    ]
    results = process_events(events)
    processed_ids = [r["id"] for r in results if r["status"] == "processed"]
    skipped_ids = [r["id"] for r in results if r["status"] == "skipped"]
    assert processed_ids == [1, 3]
    assert skipped_ids == [2, 4]
