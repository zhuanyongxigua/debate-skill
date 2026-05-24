# Method Skills Index Snippet

Paste this block into your `AGENTS.md`, `CLAUDE.md`, or system prompt to give
your agent always-on method routing awareness without requiring full skill files.

---

```
[Method Skills Index] root: ./skills
IMPORTANT: For non-trivial tasks, produce a RoutePlan before solving.
work-gate direct answer: rare fast path for simple, low-risk, self-contained tasks — artifact: ConciseAnswer
self-check: direct local action is a work-gate route, not a separate skill
agent-dispatch: current session vs same-runtime agents vs heterogeneous CLI agents; default heterogeneous CLIs are Claude Code then Codex CLI — artifact: AgentDispatchPlan
multi-candidate-analysis: diagnosis paths, decision options, or evaluation of existing candidates — artifact: CandidateAnalysis
work-gate change plan: risky repo or code changes before editing
project/source checks: use the checks required by the repo, docs, or task
structured-debate: ONLY after concrete candidates conflict and cheaper checks cannot decide — artifact: DebateRecord
work-gate final answer: built-in output gate; compress long intermediate work into a final answer — artifact: FinalAnswer
work-gate: mandatory entry gate, selects the stack — artifact: RoutePlan
```

---

This index removes the model's trigger decision point: instead of asking
"should I use a skill?", the model always knows what skills exist and when to
use them. Full skill files in `skills/` are loaded on demand for method details.

See `evals/configs/method-index.yaml` for how this is used in eval condition D.
