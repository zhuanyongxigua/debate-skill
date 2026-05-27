# Meta Method Skills

**Small agent skills for bounded debate and local CLI launch.**

This repo intentionally stays narrow. It does not try to be a general method
catalog, agent framework, or work-entry gate.

It currently packages two reusable skills:

- [`debate-router`](skills/debate-router/SKILL.md): classify an explicitly
  requested debate as requirement, single-proposal, candidate, or judgment
  debate, then run a bounded critique/cross-review/arbitration flow.
- [`agent-launch`](skills/agent-launch/SKILL.md): build consistent
  non-interactive launch specs for selected local agent CLIs, including
  profile/env isolation, sandbox, network, timeout, and redacted display
  commands.

## Core Idea

`debate-router` is not a general "should I debate?" gate. If a user or parent
workflow invokes it, debate must run or the blocker must be recorded.

The default visible output is human-first: `Decision`, `Rationale`, `Dissent`,
`Open Questions`, an optional `Next Step`, `Archive`, then `Trace` as the
final visible section. When external CLI agents were selected or attempted,
`Trace` marks proposal-generation and debate-execution CLIs as successful,
failed, blocked, or unavailable. The structured audit envelope (the
`DebateRoute`, `DebateRecord`, and `DebateSummary` blocks) is required state
behind that output, archived under `~/.debate-router/<run-id>/audit.yaml`, and
referenced from the final answer without pasting the full YAML.

```text
explicit debate request
  -> classifier state (DebateRoute)
  -> frozen candidates or judgments
  -> critic round
  -> cross-review round
  -> arbitration (DebateRecord, DebateSummary)
  -> archive audit envelope at ~/.debate-router/<run-id>/audit.yaml
  -> human-first output:
       Decision, Rationale, Dissent, Open Questions, (Next Step), Archive, Trace
```

`agent-launch` is a launch helper, not an orchestrator:

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

The default visible output is human-first: `Decision`, `Rationale`, `Dissent`,
`Open Questions`, an optional `Next Step`, `Archive`, then `Trace` as the
final visible section. When external CLI agents were selected or attempted,
`Trace` must show which CLIs ran, failed, blocked, or were unavailable in
proposal generation versus debate execution. The required audit artifacts are
still `DebateRoute`, `DebateRecord`, and `DebateSummary`; they are produced as
audit state and archived under `~/.debate-router/<run-id>/audit.yaml`. The
visible answer should include only the archive path, not the full YAML.

Important constraints:

- Explicit invocation means debate is required; do not optimize it away.
- Lead the visible output with `Decision` and `Rationale`, not the YAML
  envelope. The human-first sections must stay consistent with the audit
  envelope; if they diverge, the audit envelope wins and the visible output
  is rewritten to match.
- The audit envelope is required state, not a transient by-product. Preserve
  it under `~/.debate-router/` so it can be inspected after the run.
- Caller signals like "讨论", "辩论", "discuss", or "debate" mean use the
  multi-CLI path. Proposal generation and debate execution should both use
  external CLI agents through `agent-launch` unless external CLIs were
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
- Use `agent-launch` when the user or parent workflow has selected external CLI
  agents.
- Record whether the input was treated as a requirement, one proposal, multiple
  proposals, or conflicting judgments, plus a compact process summary, in
  `DebateSummary` inside the archived audit envelope. Do not use that summary
  as a replacement for the human-first `Decision` and `Rationale`.

## Agent Launch

Use `agent-launch` when a user or parent workflow has already selected one or
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

## Project Layout

```text
skills/
  debate-router/
    SKILL.md
    agents/
    references/
  agent-launch/
    SKILL.md
    scripts/
evals/
  *.jsonl, *.md, *.py
```

## Evals

The starter evals in [`evals/`](evals/) focus on whether agents preserve the new
boundaries:

- `debate-router` is explicit-only. The default visible output is human-first
  (`Decision`, `Rationale`, `Dissent`, `Open Questions`, optional
  `Next Step`, `Archive`, then `Trace` last; `Trace` includes CLI statuses
  when external CLIs were selected or attempted), with `DebateRoute`,
  `DebateRecord`, and `DebateSummary`
  archived as audit state under `~/.debate-router/<run-id>/audit.yaml`.
- The debate entry case matches the input shape.
- Requirement debates preserve proposal generation, normalization, frozen
  debate, and traceable final synthesis as separate phases.
- Final recommendations show status, the frozen source proposals that
  materially contributed, plus accepted sourced amendments and derivation.
- External CLI launches go through `agent-launch`.
- `agent-launch` is not used to decide whether debate or CLI agents are useful.

## What This Is Not

This is not an agent framework.

It does not schedule tasks, manage memory, run supervisors, or replace coding
tools. It provides compact skill instructions and helper scripts that other
agents or parent workflows can compose.

It is also not a broad method catalog. General task routing and non-debate
workflows are deliberately outside `debate-router`.

## Contributing

When behavior changes, update the relevant `SKILL.md`, any directly referenced
files under `references/` or `scripts/`, and at least one eval that protects the
new boundary.

## License

MIT. See [`LICENSE`](LICENSE).
