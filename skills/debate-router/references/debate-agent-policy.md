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
7. Which archive path under `~/.debate-router/` will store the audit envelope
   so the human-first output stays clean while the full record remains
   retrievable?

## Topology Preservation

`debate-router` should preserve the agent set selected by the user or parent
workflow.

- If the caller says "discuss", "debate", "argue about", "讨论", "辩论", or a
  close equivalent, treat that as selected `heterogeneous_cli_agents`. Use
  multiple external CLI agents via `agent-launch` for both proposal generation
  and debate execution. Do not ask whether CLIs are worth using.
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
- Record phase-level participation for every selected or attempted CLI. Use
  separate `proposal_generation` and `debate_execution` entries, and keep
  failed, blocked, or unavailable CLIs visible instead of omitting them. Keep
  phase and role consistent: proposal-generation rows are proposers, while
  debate-execution rows are critics, cross-reviewers, or other debate roles.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 900 seconds is the default for ordinary model CLI calls, and
  1800 seconds is the default for external CLI proposal generation.
- Do not kill a child agent only because the parent harness prints a transient
  parser/router warning such as `failed to parse function arguments`, `unknown
  variant`, or a tool-call parse warning. Continue waiting if the child retries,
  enters command execution, or produces useful output.
- Kill the child agent early only when it is clearly blocked on login, OAuth,
  browser auth, credentials, stdin, an interactive prompt, or sustained
  no-output/no-progress behavior up to the configured timeout. Quiet periods
  before the configured timeout are not enough to mark `failed/no_output`.
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
- When the trigger was a discussion/debate signal, proposal generation should
  use the selected external CLI agents as independent proposers before
  normalization. Use `agent-launch` with `phase: "proposal_generation"` so the
  default wait budget is 1800 seconds unless the caller explicitly chose
  another timeout.
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

## Output Shape Policy

The caller's final output contract has priority over the debate-router layout.
Classify that contract before writing the final answer:

- `caller_format`: use when the original task, parent workflow, repository,
  source artifact, or user message specifies or implies a final format.
- `default_debate_layout`: use only when no caller/source format exists and the
  user is asking for an open chat answer.

Treat the task as `caller_format` when it says to review, re-review,复盘,归档,
更新,整理,重审, or rewrite an existing note/document, or when it names a
structured artifact such as `Diary`, `relationship`, llmwiki, daily note,
journal, report, memo, PR template, checklist, frontmatter, YAML, JSON, table,
or archive. If the exact template is not repeated in the current message,
preserve the source document or parent workflow format rather than falling back
to the default debate-router sections.

If the original task, parent workflow, repository, or user message specifies a
fixed final format, template, schema, frontmatter, checklist, journal entry
shape, archive format, or "output exactly like this" contract, preserve that
format exactly. Run the debate as internal work, archive the full audit
envelope (`DebateRoute`, `DebateRecord`, `DebateSummary`), then render only the
caller-required format. Add an archive reference only when the caller format has
a compatible metadata, notes, provenance, or footer field.

When there is no caller-required or implied final format, the default visible output is
human-first: `Decision`, `Rationale`, `Dissent`, `Open Questions`, optionally
`Next Step`, `Archive`, then `Trace` as the final visible section. When
external CLIs were selected or attempted, include their participation inside
`Trace`. The full audit envelope is required audit state but belongs in
`~/.debate-router/<run-id>/audit.yaml`, not in the normal final answer.

- When using the default layout, lead with the `Decision` and `Rationale`. The
  caller should be able to act without scrolling past YAML.
- When external CLIs were selected or attempted, include them in `Trace`.
  Separate proposal-generation CLIs from debate-execution CLIs, and mark
  `ran`, `failed`, `blocked`, or `unavailable` for each selected or attempted
  CLI.
- Derive `Trace` rows from the frozen candidates, source proposals, sourced
  amendments, critic findings, arbiter decision, `DebateRecord.cli_participation`,
  and launch results. The table must trace back to the audit envelope; do not
  invent rows. Keep `Trace` as the final visible section when the default
  layout is used.
- For each run, archive the audit envelope to
  `~/.debate-router/<run-id>/audit.yaml`. Name that path in the visible
  `Archive` section only when the default layout is used, or in a compatible
  caller-format field when one exists. Do not append `## Audit` or inline the
  YAML in the normal final answer.
- If the user later asks for debate details, read the archived YAML and answer
  from it. Show raw YAML only when the user explicitly asks for the raw record.
- Keep the visible output consistent with the audit envelope. If
  `final_recommendation` says one thing and the visible result says another,
  the audit envelope wins and the visible output must be rewritten.
- `degraded` and `blocked` runs still emit the required visible format. In the
  default layout, the `Decision` states the degraded or blocked outcome and
  `Dissent` or `Open Questions` names the blocker.
- Keep status and arbitration separate: `DebateSummary.status` reports run
  health, while `DebateRecord.arbiter.decision` reports the arbitration action.
  Use `status: degraded` for partial debates with usable but limited evidence;
  keep `arbiter.decision` as the best available action. Use
  `arbiter.decision: "blocked"` only with `status: blocked` when no responsible
  arbitration could complete.

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
