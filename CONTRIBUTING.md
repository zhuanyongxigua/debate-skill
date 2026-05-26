# Contributing

This repo is organized around Meta Method Skills and a compact routing catalog.

A contribution should make agent behavior easier to route, execute, or evaluate.
Avoid adding broad prompts that say "think carefully" without a concrete method,
artifact, or evaluation hook.

Only broad entry points should become installable agent-facing skills.
Lightweight methods should usually be implemented as `work-gate` modes or
references instead of separate skills.

## Adding or Updating a Method

1. Update the relevant `skills/<name>/SKILL.md` or `skills/work-gate/SKILL.md`.
2. Update `skills/work-gate/references/method-catalog.md` when routing changes.
3. Add or update eval coverage for new routing behavior.
4. If the method should be installable by an agent, justify why it should not be a
   `work-gate` mode first. Then add a matching `skills/<name>/SKILL.md`.

## Method Requirements

Every method should have:

- clear "Use when" conditions
- clear "Avoid when" conditions
- required context or inputs
- named artifacts
- composition rules
- known failure modes
- evaluation signals
- at least one eval when it affects routing

## Naming

Use lowercase kebab-case names for installable skills:

```text
work-gate
agent-launch
```

Use `work-gate <mode>` names for internal gate modes, such as `work-gate
candidate analysis` and `work-gate debate`.

Prefer method names over marketing names. The name should tell an agent what to
do.

Installable skills should stay sparse. Prefer names such as `work-gate` for
entry protocols and `agent-launch` for reusable CLI launch behavior. Candidate
analysis, debate, direct mode, change plans, and finalization currently live
inside `work-gate`.

## Quality Bar

Before adding a method, ask:

- Does this method change the workflow, not just the wording?
- Does it produce a durable artifact?
- Can another method consume that artifact?
- Can we tell when the method was unnecessary?
- Can we tell when it failed?

If the answer is mostly no, it is probably a prompt note rather than a skill or
work-gate mode.
