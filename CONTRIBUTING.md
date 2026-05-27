# Contributing

This repo is organized around a small number of installable agent skills.

A contribution should make agent behavior easier to execute or evaluate without
turning the skills into a broad prompt pack.

## Current Skills

- `debate-router`: explicit debate entry classification plus bounded debate
  execution.
- `agent-launch`: shared launch specs and defaults for selected local agent
  CLIs.

## Updating A Skill

1. Update the relevant `skills/<name>/SKILL.md`.
2. Update any directly referenced `references/` or `scripts/` files.
3. Update eval tasks, rubrics, or scorer checks when behavior changes.
4. Keep global orchestration concerns out of narrow skills.

## Boundaries

`debate-router` should stay narrow:

- It does not decide whether debate is necessary.
- It does not provide non-debate workflow modes.
- It classifies the debate input shape and produces `DebateRecord`.

`agent-launch` should stay narrow:

- It does not decide whether external CLIs should be used.
- It does not own debate turns, transcripts, arbitration, supervisor loops, PID
  tracking, resume/stop, or polling.
- It builds and records CLI launch specs for agents already selected by the
  user or parent workflow.

## Method Requirements

Every skill should have:

- clear "Use when" conditions in frontmatter
- explicit non-goals
- required inputs and artifacts
- composition rules with other skills
- known failure modes
- at least one eval when routing or artifact behavior changes

## Naming

Use lowercase kebab-case names for installable skills:

```text
debate-router
agent-launch
```

Prefer literal names over marketing names. The name should tell an agent what
to do.

## Quality Bar

Before adding a skill or expanding an existing one, ask:

- Does this change the workflow, not just the wording?
- Does it produce or improve a durable artifact?
- Does it preserve the skill's boundary?
- Can another skill or parent workflow consume the result?
- Can an eval catch the failure mode?

If the answer is mostly no, it is probably a prompt note rather than a skill.
