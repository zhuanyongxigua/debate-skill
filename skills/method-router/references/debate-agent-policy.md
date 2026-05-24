# Debate And Agent Policy

Use this policy when deciding between single-agent execution, independent
sampling, same-runtime multi-agent work, heterogeneous models, structured debate,
or different CLI harnesses.

## Core Rule

Do not ask "Should the agents debate?" first.

Ask:

1. Is there a hard verifier, source check, test, schema, or cheap probe?
2. Are there already concrete candidates to compare?
3. Would independent samples solve the task without interaction?
4. Is model diversity needed, or is it just extra cost?
5. Are we evaluating models, or full agent harnesses?

## Default Order

Prefer this order unless the user explicitly asks otherwise:

1. Single strong agent plus the strongest available verifier.
2. Same strong model, independent fresh sessions, aggregate with vote or verifier.
3. Same-runtime multi-agent roles: proposer, critic, judge, or path generator.
4. Heterogeneous models in the same harness.
5. Heterogeneous CLI harnesses.

## Same Model Role-Play Versus Fresh Sessions

Use fresh sessions when independence matters:

- self-consistency samples
- independent diagnoses
- proposal generation
- judge panels
- critic passes

Avoid one shared context with role-played agents when the goal is independent
evidence. Shared context can anchor later roles on the first answer.

## Same Harness Versus Different Harnesses

Use the same harness when comparing model behavior. Changing both harness and
model confounds the result because system prompts, tool permissions, context
management, edit strategy, and test execution all change.

Use different CLI harnesses only when the question is full-stack agent
performance:

- "Claude Code + model A versus Codex + model B"
- cross-agent review of a risky architecture plan
- benchmark work where the harness is part of the treatment

Before running external CLIs, inspect what is available and ask the user when
network, credentials, broader filesystem access, or other elevated permissions
are needed.

## Debate Gate

Use structured debate only when all are true:

- At least two concrete candidates exist.
- They conflict on a decision that matters.
- A verifier, source check, test, or cheap probe cannot decide immediately.
- The debate is bounded to one critique round plus arbitration unless the user
  explicitly asks for more.

Do not use debate to create the first answers.

## Coding Agent Policy

For code work, prefer this order:

1. Independent localization or patch candidates.
2. Tests, reproduction, lint, typecheck, or other verifier.
3. Critic review of concrete patches or plans.
4. Judge or merger based on evidence.
5. Debate only if candidates remain tied after probes.

Do not let language debate overrule failing tests or missing reproduction.

## Heterogeneous Model Policy

Use heterogeneous models when diversity can reduce correlated errors:

- adversarial review
- source-quality criticism
- alternative patch or test generation
- high-risk second opinion
- benchmark or ablation

Avoid heterogeneous majority voting when weaker models may lower average
candidate quality. Prefer using weaker or cheaper models as critics, test
writers, or alternative proposers, while a stronger model or verifier makes the
final decision.

## Evaluation Matrix

When quantifying debate or multi-agent value, compare these arms:

| Arm | Configuration | Question answered |
| --- | --- | --- |
| A | Single model, single run, single harness | Baseline |
| B | Same model, K fresh sessions, vote or verifier | Does independent sampling solve it? |
| C | Same model, multi-agent debate | Does interaction beat voting? |
| D | Different models, same harness, independent outputs plus judge | Does model diversity help? |
| E | Different models, same harness, debate | Does heterogeneous debate help? |
| F | Different harnesses plus different models | Which full-stack agent setup works best? |

## Metrics

Track:

- `accuracy` or `pass_at_1`
- `pass_at_k`
- `cost_per_correct`
- `latency_p50` and `latency_p95`
- `regression_rate`
- `judge_error_rate`
- `disagreement_recovery`
- `unsupported_claim_rate`
- `missed_verifier_rate`
- `unnecessary_debate_rate`

If same-model fresh sessions plus verifier match heterogeneous debate, prefer
the simpler setup.
