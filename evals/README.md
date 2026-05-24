# Evals

This directory contains a small starter eval for work-gate and route quality.

The goal is not to claim universal reliability. The goal is to make route
selection and gate adherence inspectable:

- Did the agent emit `RoutePlan:` before substantive work when `work-gate` was invoked?
- Did the gate choose a plausible method stack?
- Did it avoid unnecessary debate or multi-agent work?
- Did it use available verifiers?
- Did it explain why each skill was selected?
- Did it route direct answers/actions explicitly instead of bypassing the gate?
- Did it execute the selected method artifacts after the RoutePlan?
- Did it use `answer-finalizer` when long intermediate work needs a concise final answer?

Files:

- [`routing-tasks.jsonl`](routing-tasks.jsonl): seed routing tasks with expected stacks.
- [`route-rubric.md`](route-rubric.md): rubric for reviewing RoutePlans.
