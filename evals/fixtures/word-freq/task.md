# Bug Report: Word Frequency Counting Incorrect with Punctuation

Our word frequency counter is producing wrong results for real text. Words
adjacent to punctuation are being counted as separate tokens from the same
words without punctuation. For example, "hello," and "hello" are counted
as two different words instead of one.

Diagnose the root cause by reading both source files, then fix the bug.
The fix must pass the hidden test suite.

Output each file you need to change using this exact format (include the
complete file contents, not just the changed lines):

===FILE: src/filename.py===
[complete corrected file contents]
===END FILE===
