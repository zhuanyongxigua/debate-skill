# Evals

This directory contains a small starter eval for task routing quality.

The goal is not to claim universal reliability. The goal is to make route
selection inspectable:

- Did the router choose a plausible method stack?
- Did it avoid unnecessary debate or multi-agent work?
- Did it use available verifiers?
- Did it explain why each skill was selected?

Files:

- [`routing-tasks.jsonl`](routing-tasks.jsonl): seed routing tasks with expected stacks.
- [`route-rubric.md`](route-rubric.md): rubric for reviewing RoutePlans.
