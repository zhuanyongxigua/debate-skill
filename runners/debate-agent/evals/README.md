# debate-agent eval (real LLM)

A tiny end-to-end eval that runs the **whole debate flow with a real model** —
unlike `test/`, which mocks the brain/worker seam. It drops a request into a
self-contained scratch mailbox (`evals/mailbox/`, gitignored — it never touches
your real `~/.debate-router/`), runs the daemon's step loop, and prints the
response.

## Prerequisites

- `claude` on PATH and logged in (the default brain, and a likely worker).
- `codex` on PATH and logged in if the brain allocates Codex workers.
- The brain runs `debate-router` in plan/step mode; it works best with the
  `debate-router` skill installed for that CLI, but the brain prompt also
  restates the plan/step contract so a bare model can still drive a basic debate.

## Run

```bash
cd runners/debate-agent
npm run eval                     # real model; default brain = claude, sample request
npm run eval -- --brain codex    # use codex as the brain
npm run build && node dist/evals/run-eval.js path/to/your-request.json
```

Offline wiring check (no real model — stubbed brain + workers, to prove the
mailbox + step loop plumbing):

```bash
npm run eval:mock
```

## Files

```
evals/
  requests/sample-debate.json   # a debate_request (repo is injected at runtime)
  fixture-repo/                 # a real dir so the allowlist's repo check passes
  run-eval.ts                   # drops the request, runs the loop, prints the response
  mailbox/                      # scratch (gitignored)
```

## What it exercises

The request file's `repo` is the `__FIXTURE_REPO__` placeholder; the runner
fills it with the fixture-repo's absolute path and builds an allowlist that
permits `claude`/`codex` read-only in that repo. Every CLI the loop spawns — the
brain and every worker — runs in `read_only_review`, so the eval cannot edit
anything.
