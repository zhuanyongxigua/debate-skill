# Bug Report: Rate Limiter Not Working Per User

Users report that our API rate limiter is not enforcing limits correctly.
The limit should be applied independently per user: each user gets their own
quota of requests per time window. Currently, one user exhausting the limit
blocks all other users from making requests.

Diagnose the root cause by reading the source files, then fix the bug.
The fix must pass the hidden test suite.

Output each file you need to change using this exact format (include the
complete file contents, not just the changed lines):

===FILE: src/filename.py===
[complete corrected file contents]
===END FILE===
