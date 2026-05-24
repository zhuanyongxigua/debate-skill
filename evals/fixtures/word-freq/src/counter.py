from src.tokenizer import tokenize


def word_frequency(text: str) -> dict:
    """Return a frequency map of words in text."""
    freq: dict = {}
    for token in tokenize(text):
        freq[token] = freq.get(token, 0) + 1
    return freq


def top_n_words(text: str, n: int = 5) -> list:
    """Return the n most frequent (word, count) pairs."""
    freq = word_frequency(text)
    return sorted(freq.items(), key=lambda x: x[1], reverse=True)[:n]
