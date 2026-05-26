# Contributing

This repo is organized around Meta Method Skills and Method Cards.

A contribution should make agent behavior easier to route, execute, or evaluate.
Avoid adding broad prompts that say "think carefully" without a concrete method,
artifact, or evaluation hook.

A Method Card is the human-readable spec. Only broad entry points should become
installable agent-facing skills. Lightweight methods should usually be
implemented as `work-gate` modes or references instead of separate skills.

## Adding a Method Card or Meta Skill

1. Copy `method-cards/TEMPLATE.md`.
2. Fill in every section.
3. Add the card to `method-cards/README.md`.
4. Add or update at least one recipe when the card composes with others.
5. If the card should be installable by an agent, justify why it should not be a
   `work-gate` mode first. Then add a matching `skills/<name>/SKILL.md`.

## Card Requirements

Every card should include:

- clear "Use when" conditions
- clear "Avoid when" conditions
- required inputs
- named outputs
- composition rules
- known failure modes
- evaluation signals
- one minimal example

## Naming

Use lowercase kebab-case names for installable skills:

```text
work-gate
agent-dispatch
```

Use `work-gate <mode>` names for internal gate modes, such as `work-gate
candidate analysis` and `work-gate debate`.

Prefer method names over marketing names. The name should tell an agent what to
do.

Installable skills should stay sparse. Prefer names such as `work-gate` and
`agent-dispatch` for entry protocols or execution topology. Candidate analysis,
debate, direct mode, change plans, and finalization currently live inside
`work-gate`.

## Quality Bar

Before adding a card, ask:

- Does this method change the workflow, not just the wording?
- Does it produce a durable artifact?
- Can another method consume that artifact?
- Can we tell when the method was unnecessary?
- Can we tell when it failed?

If the answer is mostly no, it is probably a prompt note rather than a Method
Card.
