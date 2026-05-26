# Method Catalog

Use this catalog only when the route is not obvious from the task. Prefer the
smallest stack that covers the user's intent, risk, and required artifacts.

## Installable Skills And Work-Gate Modes

| Method | Best for | Avoid when | Primary artifact |
| --- | --- | --- | --- |
| `work-gate` | Route-before-work entry protocol, direct mode, code-change planning, and tool-loop planning | A previous RoutePlan already selected a method and the current step is just execution | RoutePlan / ChangePlan |
| `agent-dispatch` | Execution-topology helper for a selected `work-gate` mode: current session, same-runtime agents, or heterogeneous CLI agents | No parent mode needs independent agents, or a deterministic check can decide now | AgentDispatchPlan |

Internal `work-gate` modes:

| Mode | Best for | Avoid when | Primary artifact |
| --- | --- | --- | --- |
| `work-gate direct` | Simple low-risk self-contained answers or one obvious low-risk local action | Current facts, broad code/file changes, multiple workflows, high-risk domains, useful external feedback available | DirectResult |
| `work-gate change plan` | Non-trivial code/file changes before editing | One obvious tiny local action | ChangePlan |
| `work-gate candidate analysis` | Repo/system diagnosis, strategy, product, architecture, positioning, creative options, and rubric scoring of existing candidates | Tasks with one obvious correct answer or a project check that should decide | CandidateAnalysis |
| `work-gate debate` | Requirement, single-proposal, candidate, or judgment debate when checks cannot decide cheaply | Unbounded first-answer generation, factual disputes with sources, code disputes with tests, low-stakes disagreement | DebateRecord |
| `work-gate final answer` | Long, noisy, multi-candidate, debate/review-heavy, or executive-summary outputs | Missing evidence, unresolved conflict, user asked for full audit trail | FinalAnswer |

## Common Stacks

### Direct Work

`work-gate direct`

Use only when the Direct Gate passes. Direct is a selected method, not a bypass
around routing. It can return `kind: answer` or `kind: local_action`. It should
remain a low-frequency fast path under strict mode; if broad tasks are
repeatedly routed here, the gate is too weak. For local actions, stop and route
again if the action reveals ambiguity or risk.

### Factual Or Current Answer

`work-gate` with source/citation constraints.

Do not invent a dedicated retrieval workflow. The gate should simply state that
the answer depends on current or authoritative sources, then use the available
search, docs, or project evidence required by the host environment.

### Open Strategy

`work-gate candidate analysis -> work-gate debate only if top candidates remain unresolved -> work-gate final answer`

Use pre-mortem before final recommendation when risk or ambiguity is high. Do
not start with debate before distinct proposals exist.

### Repo Debugging

`work-gate candidate analysis -> work-gate change plan -> project-required checks`

Add `work-gate debate` only when top candidates remain close after cheap probes.
Do not patch the first plausible file before localization unless the failing
location is already proven.

### Repo Feature Planning

`work-gate change plan -> work-gate candidate analysis evaluation mode or work-gate debate for tradeoffs -> project-required checks`

Use `work-gate candidate analysis` first if the feature depends on uncertain
existing behavior. Use a `work-gate direct` for obvious one-file
changes with clear validation.

### Tool Or Browser Task

Use a `work-gate direct` for one obvious step. For multi-step tool
work, write the observe-act plan in the RoutePlan and check the result with the
available project or environment feedback.

### High-Risk Domain

There is no dedicated high-risk skill. Route conservatively inside `work-gate`:
require authoritative sources when applicable, state scope and uncertainty, and
preserve human-review boundaries. Do not let model debate be final authority.

### Debate, Ensemble, and Agent Harness Choice

Use `agent-dispatch` only when a selected mode may involve independent agents or
external CLI agents. It is not a candidate method and should not appear as a
standalone option in candidate analysis.

Dispatch bias inside `agent-dispatch`:

1. Current session for simple, tool-bound, or directly checkable tasks.
2. Heterogeneous CLI harnesses when independent review, debate, benchmark, or
   high-risk second opinion benefits from model/tool/harness diversity.
3. Same-runtime multi-agent roles when independence helps but heterogeneity is
   not worth the cost or permissions.
4. Heterogeneous models in the same harness when model diversity is the
   experiment or when weaker models act as critics/test writers.

Use `work-gate debate` after independent candidates exist or when the debate
entry case is explicit. Do not use role-play inside one shared context when
independence is important; prefer fresh sessions.
Do not use heterogeneous models as final majority voters if weaker models can
drag down answer quality; use them as critics or alternative proposers.

## Candidate Analysis Strategy

Use `work-gate candidate analysis` in three modes:

- `diagnosis`: generate root-cause paths for uncertain bugs or system failures.
- `decision`: generate distinct options for open-ended choices.
- `evaluation`: normalize and score candidates that already exist.

If candidates already exist, skip generation by default. Generate only a missing
baseline or control candidate when that improves the comparison.

## Debate Strategy

Use `work-gate debate` in four entry cases:

- `requirement_debate`: no candidates exist, so generate candidate positions
  first, freeze them, then debate if needed.
- `single_proposal_debate`: one proposal exists, so debate adopt/revise/reject/probe.
- `candidate_debate`: multiple candidates exist, so freeze and cross-critique
  them directly.
- `judgment_debate`: conflicting judgments or claims exist about one artifact,
  so freeze those judgments as candidates.

Use one of three debate styles:

- `parallel_positions`
- `proposal_attack`
- `frozen_candidates`

Every debate requires cross-review and arbiter evidence. Do not decide by vote
count or rhetorical confidence.

## Work-Gate Change Planning

When code or file changes are not trivial direct work, `work-gate` owns the
planning contract directly. Produce a concise change plan with:

- goal and non-goals
- files or areas likely to change
- ordered steps
- project-required checks from docs, scripts, CI, package metadata, or user instructions
- risks and rollback notes when useful

Do not expose change planning as a separate skill.

## Agent Execution Strategy

Treat multi-agent work as execution topology, not as a method primitive.

Use `agent-dispatch` to choose the execution topology for a selected work mode:
candidate generation, rubric scoring, critic review, debate, benchmarking, or
cross-agent review.

Use the current session when the task is simple, tool-bound, or project checks
can decide.

Use same-runtime fresh-session multi-agent execution when independence is useful
but heterogeneity is not required:

- candidate generation
- rubric scoring or judging
- bounded critics

Prefer heterogeneous CLI agents when diversity of model, tool, or runtime is
part of the requirement:

- cross-agent code review
- benchmark or comparison work
- high-risk second opinion
- explicit user request for Codex plus Claude Code or another CLI
- tasks where same-runtime correlation would undermine the result

Default heterogeneous dispatch uses at most two CLIs: Claude Code first, Codex
CLI second. Use other CLIs only when the user explicitly asks or approves a
fallback. All CLI child agents must be non-interactive. Ask before running
external tools that require network, credentials, broad filesystem access, or
other elevated permissions. Do not use heterogeneity as a substitute for source
checks, tests, schema validation, or cheap probes.

## Finalization Strategy

Use the built-in `work-gate final answer` gate after the selected method stack
when output is long, multi-candidate, debate/review-heavy, or likely to contain
process recap. It is output shaping inside `work-gate`, not a separate skill.

Keep only the decision or answer, main reason or evidence, material risk or
uncertainty, and next action. Do not use finalization to hide failed checks,
missing evidence, or unresolved conflicts.
