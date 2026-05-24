# Method Catalog

Use this catalog only when the route is not obvious from the task. Prefer the smallest stack that covers the user's intent, risk, and available validation.

## Method Primitives

| Method | Best for | Avoid when | Evidence strength | Primary artifact |
| --- | --- | --- | --- | --- |
| `direct-execution` | Simple low-risk tasks with an obvious next action and cheap confirmation | Ambiguous, high-risk, cross-file, current-info, or judgment-heavy tasks | Heuristic | Completion note or verifier result |
| `self-consistency` | Standard-answer reasoning, math, logic, low-risk testable answers | Open-ended decisions, current facts without retrieval, tasks where samples are not independent | Strong | VoteRecord |
| `rag-claim-check` | Facts, research, current info, citations, docs | Pure creative tasks or tasks with no factual claims | Strong | ClaimTable |
| `multi-proposal-synthesis` | Strategy, product, business, architecture direction | Tasks with a hard verifier or single correct answer | Medium | DecisionMemo |
| `creative-curator` | Naming, copy, style, story, variants | Correctness-first tasks, factual claims without retrieval | Heuristic | CreativeBoard |
| `multipath-localization` | Repo bugs and unclear root causes | Obvious one-file changes, already-proven root cause | Medium | PathCards |
| `edit-plan` | Repo implementation planning after requirements or root cause are known | Premature root cause guesses, tasks that only need direct execution | Medium | EditPlan |
| `hard-verifier` | Code, schemas, calculations, tests, deterministic checks | Pure preference questions, checks that do not cover the claim being judged | Strong | VerificationRecord |
| `multi-judge` | Evaluation, ranking, review, subjective scoring with a rubric | Tasks where a test/source can decide, no rubric, no candidate artifacts | Medium | JudgeScorecard |
| `structured-debate` | Conflicting concrete candidates with no cheap verifier | First-answer generation, factual disputes with sources, code disputes with tests, low-stakes disagreement | Mixed | DebateRecord |
| `tree-search` | Puzzles, planning, constraint search, backtracking | Simple single-pass tasks, tasks with no state or branching constraints | Strong | BranchTable |
| `react-reflexion` | Tool/web/browser/shell loops where observations update the plan | Pure offline reasoning, destructive actions without approval | Strong | TrajectoryLog |
| `high-risk-evidence` | Medical/legal/financial/security/compliance | Low-risk informal advice or non-actionable general discussion | Medium | RiskMemo |

## Common Stacks

### Math or Logic

`self-consistency -> hard-verifier`

Use short structured debate only if answers remain tied after verification.
Do not use retrieval unless the task depends on external facts.

### Factual Research

`rag-claim-check -> hard-verifier`

Use a critic only to find unsupported claims.

### Open Strategy

`multi-proposal-synthesis -> multi-judge when a rubric is useful -> structured-debate only if top candidates remain unresolved`

Use pre-mortem before final recommendation when risk or ambiguity is high.
Do not start with debate before distinct proposals exist.

### Creative Work

`creative-curator`

Add `multi-judge` only when selecting among final options.

### Repo Debugging

`multipath-localization -> hard-verifier/probes -> edit-plan -> hard-verifier`

Add `structured-debate` only when top PathCards remain close after probes.
Do not patch the first plausible file before localization unless the failing location is already proven.

### Repo Feature Planning

`edit-plan -> multi-judge or structured-debate for tradeoffs -> hard-verifier`

Use `multipath-localization` first if the feature depends on uncertain existing behavior.
Use direct execution for obvious one-file changes with clear validation.

### Tool or Browser Task

`react-reflexion -> hard-verifier`

Add `high-risk-evidence` when the task touches irreversible or sensitive actions.
Use direct execution when the next tool action is obvious and low risk.

### High-Risk Domain

`high-risk-evidence -> rag-claim-check -> multi-judge if useful -> human review language`

Never let model debate be final authority.

### Debate, Ensemble, and Agent Harness Choice

Baseline order:

1. Single strong agent plus verifier.
2. Same model, independent fresh sessions, voting or verifier selection.
3. Same-runtime multi-agent roles for proposal, critique, judging, or PathCards.
4. Heterogeneous models in the same harness when model diversity is the experiment or when weaker models act as critics/test writers.
5. Heterogeneous CLI harnesses only for full-stack agent comparison or explicit user request.

Use `structured-debate` after independent candidates exist. Do not use role-play
inside one shared context when independence is important; prefer fresh sessions.
Do not use heterogeneous models as final majority voters if weaker models can
drag down answer quality; use them as critics or alternative proposers.

## Agent Execution Strategy

Treat multi-agent work as execution topology, not as a method primitive.

Use one strong agent as the baseline when the task is simple, tool-bound, or has
a hard verifier.

Use same-runtime fresh-session multi-agent execution when independence is useful but
heterogeneity is not required:

- independent answer samples
- PathCard generation
- proposal generation
- rubric judges
- bounded critics

Use heterogeneous CLI agents only when diversity of model, tool, or runtime is
part of the requirement:

- cross-agent code review
- benchmark or comparison work
- high-risk second opinion
- explicit user request for Codex plus Claude Code or another CLI
- tasks where same-runtime correlation would undermine the result

When heterogeneous CLI agents are needed, first inspect the environment for
available CLIs. Ask the user before running external tools that require network,
credentials, broad filesystem access, or other elevated permissions. Do not use
heterogeneity as a substitute for retrieval, tests, schema validation, or cheap
probes.
