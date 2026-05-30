# Meta Method Skills

**Small agent skills for bounded debate and local CLI launch.**

This repo intentionally stays narrow. It does not try to be a general method
catalog, agent framework, or work-entry gate.

It currently packages two reusable skills plus one standalone runner:

- [`debate-router`](skills/debate-router/SKILL.md): classify an explicitly
  requested debate. By default it does not run the debate in-session — it writes
  a request file to `~/.debate-router/requests/`, watches `responses/` for the
  result, and presents it. It runs the debate in-session (via `cli-launch`) only
  when the human explicitly asks.
- [`cli-launch`](skills/cli-launch/SKILL.md): build consistent
  non-interactive launch specs for selected local agent CLIs, including
  profile/env isolation, sandbox, network, timeout, and redacted display
  commands.

[`runners/agent-runner`](runners/agent-runner/README.md) is **not** a skill — it
is a standalone processor (TypeScript/Node) that the human runs outside the
sandbox to execute debate requests and write the results back. It is reached
through the request/response file mailbox above, not by invoking it from a
session.

## Core Idea

`debate-router` is not a general "should I debate?" gate. If a user or parent
workflow invokes it, debate must run or the blocker must be recorded.

If the original task has a fixed or implied output format, that format wins.
The debate runs as internal work, the structured audit envelope is archived,
and the final visible answer keeps the caller's template instead of switching
to the debate-router layout. This includes wiki/diary/review/archive tasks such
as `Diary`, `relationship`, llmwiki, daily notes, reports, checklists,
frontmatter, tables, YAML, or JSON, even when the exact template is not repeated
in the latest prompt.

When there is no caller-required format, the default visible output is
human-first: `Decision`, `Rationale`, `Dissent`, `Open Questions`, an optional
`Next Step`, `Archive`, then `Trace` as the final visible section. When
external CLI agents were selected or attempted, `Trace` marks
proposal-generation and debate-execution CLIs as successful, failed, blocked,
or unavailable. The structured audit envelope (the `DebateRoute`,
`DebateRecord`, and `DebateSummary` blocks) is required state behind that
output, archived under `~/.debate-router/<run-id>/audit.yaml`, and referenced
from the final answer without pasting the full YAML when the visible format
allows it.

```text
explicit debate request
  -> classifier state (DebateRoute)
  -> frozen candidates or judgments
  -> critic round
  -> cross-review round
  -> arbitration (DebateRecord, DebateSummary)
  -> archive audit envelope at ~/.debate-router/<run-id>/audit.yaml
  -> final visible output:
       caller format if specified; otherwise Decision, Rationale, Dissent,
       Open Questions, (Next Step), Archive, Trace
```

`cli-launch` is a launch helper, not an orchestrator:

```text
selected external CLI agents
  -> AgentLaunchPlan
  -> non-interactive command specs
  -> parent orchestrator owns lifecycle and judgment
```

## Debate Router

Use `debate-router` only after debate has already been selected. It classifies
the input shape:

| Entry case | Use when |
| --- | --- |
| `requirement_debate` | The user gave a raw requirement, problem, or goal with no concrete proposal. |
| `single_proposal_debate` | The user gave one proposal, plan, patch, design, review, or claim. |
| `candidate_debate` | The user gave multiple proposals, plans, patches, answers, or approaches. |
| `judgment_debate` | The user gave conflicting reviews, findings, or judgments about one artifact. |

If the caller already has a fixed or implied output format, keep it. The
debate-router format is only the default visible layout when no stronger caller
or source format exists.
The required audit artifacts are still `DebateRoute`, `DebateRecord`, and
`DebateSummary`; they are produced as audit state and archived under
`~/.debate-router/<run-id>/audit.yaml`.

When no caller format exists, the default visible output is human-first:
`Decision`, `Rationale`, `Dissent`, `Open Questions`, an optional `Next Step`,
`Archive`, then `Trace` as the final visible section. When external CLI agents
were selected or attempted, `Trace` must show which CLIs ran, failed, blocked,
or were unavailable in proposal generation versus debate execution. The visible
answer should include only the archive path, not the full YAML.

Important constraints:

- Explicit invocation means debate is required; do not optimize it away.
- Caller-required final formats outrank the default debate-router visible
  layout. Do not replace a journal, wiki, schema, checklist, or archive
  template with `Decision` / `Rationale` / `Trace`.
- If the task says to review, re-review,复盘,归档,更新,整理,重审, or rewrite an
  existing `Diary`, `relationship`, llmwiki, report, checklist, table,
  frontmatter, YAML, JSON, or archive, treat it as a caller-format task even if
  the template is not pasted again.
- Lead the visible output with `Decision` and `Rationale`, not the YAML
  envelope when the default layout is being used. The human-first sections must
  stay consistent with the audit envelope; if they diverge, the audit envelope
  wins and the visible output is rewritten to match.
- The audit envelope is required state, not a transient by-product. Preserve
  it under `~/.debate-router/` so it can be inspected after the run.
- Caller signals like "讨论", "辩论", "discuss", or "debate" mean use the
  multi-CLI path. Proposal generation and debate execution should both use
  external CLI agents through `cli-launch` unless external CLIs were
  explicitly disabled or are blocked. External CLI proposal generation should
  use `phase: "proposal_generation"` and the 1800 second default timeout.
- When external CLIs were selected, record their phase-by-phase participation:
  which CLIs joined proposal generation, which joined debate execution, and
  which selected CLIs failed, blocked, or were unavailable. Show this in the
  final visible `Trace` table. Do not mark a quiet proposer as
  `failed/no_output` before the configured timeout unless there is a concrete
  blocker such as auth, stdin, or an interactive prompt.
- For raw requirements, generate 2-4 candidate positions or proposals first.
  If external CLI agents were selected, use them as independent proposers where
  practical.
- Normalize requirement proposals before debate: deduplicate, assign stable
  IDs, record proposer source, and degrade instead of debating if fewer than
  two distinct proposals survive.
- Freeze candidates or judgments before critique.
- Require cross-review before arbitration.
- Do not decide by vote count, confidence, or consensus pressure.
- Final recommendations may combine proposals, but only through traceable
  `source_proposals` and `sourced_amendments`. A useful fragment from a weak or
  rejected proposal must be validated by debate and explicitly accepted by the
  arbiter before it appears in the final recommendation.
- Degraded and blocked debates keep the same `DebateSummary` envelope with
  `status` and `status_reason`; they do not silently switch to a different
  output shape. `DebateSummary.status` reports run health, while
  `DebateRecord.arbiter.decision` reports the arbitration action; use
  `arbiter.decision: "blocked"` only when `status: blocked` and arbitration
  could not responsibly complete.
- Use project checks, tests, sources, or probes as evidence, not as a reason to
  cancel the debate after `debate-router` is active.
- Use `cli-launch` when the user or parent workflow has selected external CLI
  agents.
- Record whether the input was treated as a requirement, one proposal, multiple
  proposals, or conflicting judgments, plus a compact process summary, in
  `DebateSummary` inside the archived audit envelope. Do not use that summary
  as a replacement for the human-first `Decision` and `Rationale`.

## CLI Launch

Use `cli-launch` when a user or parent workflow has already selected one or
more external agent CLIs such as Claude Code, Codex CLI, or GitHub Copilot CLI.

It owns common launch details:

- provider command shape
- non-interactive mode
- profile and environment isolation
- sandbox, network, and approval intent
- timeout and wait policy
- prompt transport and redacted display commands
- blocked/unavailable reporting

Ordinary CLI calls default to 900 seconds. External CLI proposal generation
defaults to 1800 seconds because proposers often need to read context before
returning an independent proposal.

It does not own debate turns, transcripts, arbitration, supervisor loops, PID
tracking, polling, resume/stop, or fallback decisions.

## Runners

The skill layer in `skills/` is runtime-free and framework-free. Optional local
runners live **outside** `skills/` as narrow execution adapters, for
environments that explicitly grant them permission.

[`runners/agent-runner`](runners/agent-runner/README.md) is a standalone
processor (TypeScript/Node) that the human runs **outside** the sandbox. It
launches the `claude` and `codex` CLIs — one at a time (`run`) or N in parallel
(`run-batch`) — to execute debate requests, without the sandboxed parent ever
spawning a CLI itself. It owns only the execution boundary — allowlists,
`realpath` cwd, static argv, env allowlist, a `capability` sandbox posture
(`read_only_review` by default, so debate children cannot edit the repo),
concurrency caps, timeout, process-group kill, and execution audit — and owns
**no** debate semantics.

The decoupling exists because a sandboxed parent (e.g. a locked-down Codex app)
can write files but cannot spawn CLIs without tripping review. So `debate-router`
just **writes a request file** to `~/.debate-router/requests/`; the runner (the
human's out-of-sandbox processor) does the work and writes the result to
`~/.debate-router/responses/`. The runner is reached through that file mailbox,
not by invoking it from a session. It is not yet published to npm — install from
`runners/agent-runner` via `install.sh` (see its README for allowlist + setup).

The two audit trails stay separate, linked only by `run_id`:
`~/.debate-router/<run-id>/` (protocol, owned by `debate-router`) and
`~/.agent-runner/<run-id>/` (execution, owned by the runner).

## Project Layout

```text
AGENTS.md                # project rules for agents working in this repo
skills/
  debate-router/         # classify a debate; emit a request file (or run via cli-launch)
    SKILL.md  agents/  references/
  cli-launch/            # build non-interactive CLI launch specs
    SKILL.md  scripts/
runners/
  agent-runner/          # standalone processor (outside skills/, run by the human)
    README.md            # spec + security model
    src/  bin/  config/  rules/  test/   # TypeScript (Node >=18), compiled to dist/
    package.json  tsconfig.json  install.sh
evals/
  *.jsonl, *.md, *.py
```

## Evals

The starter evals in [`evals/`](evals/) focus on whether agents preserve the new
boundaries:

- `debate-router` is explicit-only. The default visible output is human-first
  only when the caller has not supplied a fixed output format. With a caller
  format, the visible result preserves that format while `DebateRoute`,
  `DebateRecord`, and `DebateSummary` are archived as audit state under
  `~/.debate-router/<run-id>/audit.yaml`.
- The debate entry case matches the input shape.
- Requirement debates preserve proposal generation, normalization, frozen
  debate, and traceable final synthesis as separate phases.
- Final recommendations show status, the frozen source proposals that
  materially contributed, plus accepted sourced amendments and derivation.
- External CLI launches go through `cli-launch`.
- `cli-launch` is not used to decide whether debate or CLI agents are useful.

## What This Is Not

This is not an agent framework.

It does not schedule tasks, manage memory, run supervisors, or replace coding
tools. It provides compact skill instructions and helper scripts that other
agents or parent workflows can compose. The skill layer carries no runtime; the
only executable component is the optional, separately-permissioned
[`runners/agent-runner`](runners/agent-runner/README.md) execution adapter.

It is also not a broad method catalog. General task routing and non-debate
workflows are deliberately outside `debate-router`.

## Contributing

When behavior changes, update the relevant `SKILL.md`, any directly referenced
files under `references/` or `scripts/`, and at least one eval that protects the
new boundary.

## License

MIT. See [`LICENSE`](LICENSE).
