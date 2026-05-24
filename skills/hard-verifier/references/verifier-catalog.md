# Verifier Catalog

| Task | Preferred verifier |
| --- | --- |
| JavaScript/TypeScript code | `npm test`, `pnpm test`, `tsc`, eslint, browser smoke test |
| Python code | `pytest`, `mypy`, `ruff`, targeted reproduction script |
| Rust/Go/etc. | compiler, unit tests, integration tests, benchmarks |
| SQL/data | query execution, row counts, schema checks, invariants |
| Math | calculator, symbolic solver, independent derivation |
| JSON/structured output | parser plus JSON Schema validation |
| Web UI | Playwright/browser screenshot, interaction smoke test |
| Factual claim | primary source citation, contradiction search |
| File conversion | open/render output, checksum or content diff |

Record exact commands and actual outcomes. If the verifier is absent, design the cheapest new probe before using debate.

Safety gate: prefer local read-only checks first. Ask before network access,
credentials, paid APIs, external CLIs, production systems, destructive writes,
or long-running jobs.
