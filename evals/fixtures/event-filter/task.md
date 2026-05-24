# Bug Report: Events Being Processed Incorrectly

Our event processor is behaving backwards. Events that should be processed
(login, logout, purchase, view) are being marked as skipped, while events
that should be skipped (spam, unknown, bot traffic) are being marked as processed.

The bug affects downstream analytics and billing. Diagnose the root cause by
reading both source files, then fix the bug.
The fix must pass the hidden test suite.

Output each file you need to change using this exact format (include the
complete file contents, not just the changed lines):

===FILE: src/filename.py===
[complete corrected file contents]
===END FILE===
