from src.counter import word_frequency, top_n_words


def test_basic_frequency():
    freq = word_frequency("cat cat dog")
    assert freq["cat"] == 2
    assert freq["dog"] == 1


def test_frequency_with_punctuation():
    freq = word_frequency("Hello, world! Hello, Python.")
    assert freq.get("hello") == 2, f"Expected hello=2, got freq={freq}"
    assert freq.get("world") == 1, f"Expected world=1, got freq={freq}"


def test_top_n_words():
    text = "the cat sat on the mat. the cat."
    top = top_n_words(text, n=2)
    words = [w for w, _ in top]
    assert "the" in words, f"Expected 'the' in top-2, got {words}"
    assert "cat" in words, f"Expected 'cat' in top-2, got {words}"
