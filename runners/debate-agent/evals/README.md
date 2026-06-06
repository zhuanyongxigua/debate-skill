# debate-agent eval (real CLI)

A tiny end-to-end eval for the daemon. It drops a `debate_request` into a
self-contained scratch mailbox (`evals/mailbox/`, gitignored — it never touches
your real `~/.debate-router/`), runs the whole flow — **plan** (real planner CLI)
then **execute** (real worker CLIs) — and prints the `debate_result`.

The planner reuses the `debate-router` skill's strategy (install the skill for
the planner CLI). The strict plan format and its validation live in the runner.

## Prerequisites

- `codex` on PATH and logged in (the default when the sample request omits
  `providers`).
- Any other provider explicitly listed in your request file, such as `claude`, on
  PATH and logged in.

## Run

```bash
cd runners/debate-agent
npm run eval                     # real CLIs; sample request defaults to codex-only
npm run build && node dist/evals/run-eval.js path/to/your-request.json
```

The request file controls providers. Omitted `providers` means `["codex"]`; add
other engines explicitly in the request, and set `planner_provider` there if a
full debate should use a non-first planner.

Offline wiring check (no real CLI — scripted planner + stubbed workers, to prove
the mailbox + plan + execute plumbing):

```bash
npm run eval:mock
```

## Files

```
evals/
  requests/sample-debate.json   # a debate_request (repo is injected at runtime)
  fixture-repo/                 # a real dir so the allowlist's repo check passes
  run-eval.ts                   # drops the request, runs plan+execute, prints the response
  mailbox/                      # scratch (gitignored)
```

## What it exercises

The request file's `repo` is the `__FIXTURE_REPO__` placeholder; the runner fills
it with the fixture-repo's absolute path and builds an allowlist that permits
`claude`/`codex` read-only in that repo. The planner and every worker run in
`read_only_review` (capability is forced in code), so the eval cannot edit
anything. The `debate_result`'s `answer_markdown` is the answer worker's output.
