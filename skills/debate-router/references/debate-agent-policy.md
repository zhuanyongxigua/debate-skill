# Debate Router Agent Policy

Use this policy only after `debate-router` is already active.

This policy does not decide whether debate is necessary. It helps preserve the
selected execution topology and keep CLI launches bounded.

## Core Rule

Do not ask "Should we debate?" after `debate-router` was explicitly invoked.

Ask only:

1. Which entry case is this?
2. Which candidates, proposal, requirement, or judgments must be frozen?
3. Which topology did the user or parent workflow select?
4. Which evidence, checks, or probes should inform the debate?
5. Which proposal fragments did the debate actually validate for synthesis?
6. Which blocker should be recorded if a selected agent cannot run?

## Topology Preservation

`debate-router` should preserve the agent set selected by the user or parent
workflow.

- If no external CLI agents were selected, use current-session or same-runtime
  critic roles.
- If one external CLI was selected, use `single_external_cli_agent`.
- If two or more external CLIs were selected, use `heterogeneous_cli_agents`.
- If a selected CLI is missing, unauthenticated, blocked, or unsafe, record that
  status. Do not silently replace it unless fallback was pre-approved.

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

Use the same harness when the debate is evaluating model behavior. Changing both
harness and model confounds the result because system prompts, tool
permissions, context management, edit strategy, and test execution all change.

Use different CLI harnesses when the user or parent workflow explicitly wants
full-stack agent behavior or robust independent review, then use `agent-launch`
for the concrete startup plan:

- "Claude Code + model A versus Codex + model B"
- cross-agent review of a risky architecture plan
- benchmark work where the harness is part of the treatment

Before running external CLIs, inspect what is available and ask the user when
network, credentials, broader filesystem access, or other elevated permissions
are needed.

For Codex CLI specifically, do not assume a child `codex exec` process can use
network just because the command exists. If the task needs SSH, package
registries, external APIs, web access, or remote docs, the `AgentLaunchPlan`
must state the Codex sandbox/profile and whether network is enabled, approved,
blocked, or unknown. If network is blocked, report Codex as blocked for that
capability instead of treating the failure as a model-quality result.

## CLI Agent Invocation Rules

Use `agent-launch` whenever `debate-router` has selected or inherited
`single_external_cli_agent` or `heterogeneous_cli_agents`.

- Do not invoke Gemini or other CLIs unless the user explicitly asks or approves
  fallback.
- Prefer non-interactive modes:
  - Claude Code: `claude -p` or `claude --print`
  - Codex CLI: `codex exec`
- For Codex CLI, record the intended sandbox/profile and network status when
  the child task needs network or broad filesystem access.
- Do not launch interactive TUI sessions for child agents.
- Use read-only, plan, or no-edit modes when available.
- Do not let child agents edit files unless the user explicitly requested
  implementation.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 900 seconds is the default for ordinary model CLI calls.
- Do not kill a child agent only because the parent harness prints a transient
  parser/router warning such as `failed to parse function arguments`, `unknown
  variant`, or a tool-call parse warning. Continue waiting if the child retries,
  enters command execution, or produces useful output.
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

## Debate Entry Cases

Choose exactly one entry case:

- `requirement_debate`: no candidates exist, so candidate generation happens
  first and the generated candidates are frozen before critique. If external
  CLI agents were selected, use those selected agents as independent proposers
  where practical.
- `single_proposal_debate`: one proposal exists and the debate is adopt,
  revise, reject, or probe.
- `candidate_debate`: multiple candidates exist and conflict on a decision that
  matters.
- `judgment_debate`: conflicting judgments or claims exist about one artifact.

Do not use unbounded debate to create first answers. If the task is a raw
requirement, generate candidates first, freeze them, then debate those
candidates.

Candidate generation for `requirement_debate` is part of the debate protocol,
not a separate multi-path analysis method.

For requirement debates, treat proposal generation and final synthesis as
separate from critique:

- Generate and normalize 2-4 distinct proposals before debate.
- Debate execution may not mutate the frozen proposals.
- If normalization leaves fewer than two distinct usable proposals, return a
  degraded debate record rather than pretending a single proposal is a normal
  debate.
- Reopen proposal generation at most once, and only if the caller explicitly
  allowed a restart. If the gap remains, finish degraded with a terminal reason.
- Do not let a proposer be the only critic validating its own proposal. If
  topology forces self-review, record it as a limitation and treat it as weak
  evidence.
- Final synthesis may salvage useful fragments from weak or rejected proposals
  only when critics surfaced the fragment, cross-review did not invalidate it,
  and the arbiter explicitly accepts it.
- Show those accepted fragments as sourced amendments with debate basis. Do not
  let the summary writer invent salvage after arbitration.
- A challenged fragment can still be accepted, but only when the arbiter
  explains why the challenge does not defeat it. Conditional acceptance should
  become a constraint or caution amendment.
- Do not create amendment-of-amendment chains; every sourced amendment points
  back to an original frozen proposal.

## Evidence Policy

Project checks, source checks, tests, schemas, calculators, or cheap probes may
inform the critics and arbiter. They do not cancel the debate once
`debate-router` is active.

Do not let language debate overrule failing tests, missing reproduction,
authoritative sources, or explicit user constraints. When a check would decide
the issue, record it as the arbiter's evidence or next probe.

## Heterogeneous Model Policy

Use heterogeneous models when diversity can reduce correlated errors:

- adversarial review
- source-quality criticism
- alternative patch or test generation
- high-risk second opinion
- benchmark or ablation

Avoid heterogeneous majority voting when weaker models may lower average
candidate quality. Prefer using weaker or cheaper models as critics, test
writers, or alternative proposers, while a stronger model or project check
makes the final decision.
