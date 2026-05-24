# Debate And Agent Policy

Use this policy as background when deciding between single-agent execution,
independent sampling, same-runtime multi-agent work, heterogeneous models,
structured debate, or different CLI harnesses.

For an actual current-session versus CLI decision, use `agent-dispatch`.

## Core Rule

Do not ask "Should the agents debate?" first.

Ask:

1. Is there a project check, source check, test, schema, or cheap probe?
2. Are there already concrete candidates to compare?
3. Would independent samples solve the task without interaction?
4. Is model diversity needed, or is it just extra cost?
5. Are we evaluating models, or full agent harnesses?

## Default Dispatch Bias

Use the current session for simple, tool-bound, or directly checkable tasks.
When independent agent work is useful and no deterministic check decides the
task, prefer `agent-dispatch`; it should lean toward heterogeneous CLI agents
for robust cross-agent review, debate, benchmarking, or high-risk second
opinions.

Default heterogeneous dispatch uses two CLIs: Claude Code first, Codex CLI
second. Add other CLIs only when the user explicitly asks or approves fallback.

## Same Model Role-Play Versus Fresh Sessions

Use fresh sessions when independence matters:

- independent answer candidates
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

Use `agent-dispatch` for different CLI harnesses when the question is full-stack
agent performance or robust independent review:

- "Claude Code + model A versus Codex + model B"
- cross-agent review of a risky architecture plan
- benchmark work where the harness is part of the treatment

Before running external CLIs, inspect what is available and ask the user when
network, credentials, broader filesystem access, or other elevated permissions
are needed.

## CLI Agent Invocation Rules

Use `agent-dispatch` whenever `work-gate` routes to heterogeneous CLI agents for
debate, review, judging, benchmarking, or cross-agent critique.

- Default heterogeneous CLI dispatch in this repo is Claude Code plus Codex CLI.
- Do not invoke Gemini or other CLIs unless the user explicitly asks or approves
  fallback.
- Prefer non-interactive modes:
  - Claude Code: `claude -p` or `claude --print`
  - Codex CLI: `codex exec`
- Do not launch interactive TUI sessions for child agents.
- Use read-only, plan, or no-edit modes when available.
- Do not let child agents edit files unless the user explicitly requested
  implementation.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 5 minutes is a reasonable default.
- Kill the child agent early only when it is clearly blocked on login, OAuth,
  browser auth, credentials, stdin, an interactive prompt, or repeated
  no-output/no-progress behavior.
- If a CLI times out, retry once with a shorter, narrower prompt before marking
  the agent unavailable.
- If a CLI blocks on login, OAuth, browser auth, credentials, or stdin, stop
  that agent and report it as unavailable. Do not wait indefinitely.
- Capture each CLI agent's output as an artifact, then arbitrate in the parent
  session.
- Do not silently substitute another CLI for a blocked one; report the blocked
  CLI and ask before changing the agent set unless fallback was pre-approved.

## Debate Gate

Use structured debate only when all are true:

- At least two concrete candidates exist.
- They conflict on a decision that matters.
- A project check, source check, test, or cheap probe cannot decide immediately.
- The debate is bounded to one critique round plus arbitration unless the user
  explicitly asks for more.

Do not use debate to create the first answers.

## Coding Agent Policy

For code work, prefer this order:

1. Independent localization or patch candidates.
2. Tests, reproduction, lint, typecheck, or other project check.
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
writers, or alternative proposers, while a stronger model or project check makes the
final decision.

## Evaluation Matrix

When quantifying debate or multi-agent value, compare these arms:

| Arm | Configuration | Question answered |
| --- | --- | --- |
| A | Single model, single run, single harness | Baseline |
| B | Same model, K fresh sessions, aggregate or project check | Does independent sampling solve it? |
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
- `missed_project_check_rate`
- `unnecessary_debate_rate`

If same-model fresh sessions plus project checks match heterogeneous debate, prefer
the simpler setup.
