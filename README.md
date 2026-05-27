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

```text
explicit debate request
  -> DebateRoute
  -> frozen candidates or judgments
  -> critic round
  -> cross-review round
  -> DebateRecord
  -> DebateSummary
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

The required artifacts are `DebateRoute`, `DebateRecord`, and `DebateSummary`.

Important constraints:

- Explicit invocation means debate is required; do not optimize it away.
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
  output shape.
- Use project checks, tests, sources, or probes as evidence, not as a reason to
  cancel the debate after `debate-router` is active.
- Use `agent-launch` when the user or parent workflow has selected external CLI
  agents.
- End by briefly saying whether the input was treated as a requirement, one
  proposal, multiple proposals, or conflicting judgments, plus a compact process
  summary.

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

- `debate-router` is explicit-only and always produces `DebateRoute` plus
  `DebateRecord` plus `DebateSummary`.
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
