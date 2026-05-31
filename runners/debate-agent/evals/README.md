# debate-agent eval (real CLI)

A tiny end-to-end eval for the daemon's **execution primitive**. It drops a
`run_batch_request` into a self-contained scratch mailbox (`evals/mailbox/`,
gitignored — it never touches your real `~/.debate-router/`), runs the daemon's
batch executor against **real** worker CLIs, and prints the response.

The debate *planning* lives in the `debate-router` skill (which composes these
requests), not in the runner — so this eval only exercises the read-only batch
execution and the embedded-output response, not a full debate.

## Prerequisites

- `claude` on PATH and logged in (a worker in the sample request).
- `codex` on PATH and logged in (the other worker in the sample request).

## Run

```bash
cd runners/debate-agent
npm run eval                     # real CLIs; runs the sample run_batch_request
npm run build && node dist/evals/run-eval.js path/to/your-request.json
```

Offline wiring check (no real CLI — stubbed worker executor, to prove the
mailbox + batch plumbing):

```bash
npm run eval:mock
```

## Files

```
evals/
  requests/sample-debate.json   # a run_batch_request (repo is injected at runtime)
  fixture-repo/                 # a real dir so the allowlist's repo check passes
  run-eval.ts                   # drops the request, runs the batch, prints the response
  mailbox/                      # scratch (gitignored)
```

## What it exercises

The request file's `repo` is the `__FIXTURE_REPO__` placeholder; the runner
fills it with the fixture-repo's absolute path and builds an allowlist that
permits `claude`/`codex` read-only in that repo. Every worker the batch spawns
runs in `read_only_review` (capability is forced in code), so the eval cannot
edit anything. Each worker's stdout comes back embedded in the response under
`items[].output`.
