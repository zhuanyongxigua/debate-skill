import re


def tokenize(text: str) -> list:
    """Split text into lowercase word tokens."""
    # BUG: lowercases but does not strip punctuation.
    # "hello," and "hello" are counted as different tokens.
    return text.lower().split()
