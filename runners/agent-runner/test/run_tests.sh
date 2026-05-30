#!/usr/bin/env bash
# Build and run the agent-runner test suite. No real claude/codex login needed.
#
#   run_tests.sh            # everything (unit + integration)
#   run_tests.sh --unit     # fast unit tests only (no subprocess/sleep)
#   run_tests.sh --integration   # integration tests only
#
# The opt-in Codex Rules check additionally needs:
#   AGENT_RUNNER_CODEX_RULES_TEST=1 and codex on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -d node_modules ]] || npm install
npm run build >/dev/null

case "${1:-all}" in
  --unit)
    exec node --test dist/test/schema.test.js dist/test/allowlist.test.js \
      dist/test/launch.test.js dist/test/audit.test.js dist/test/runner.test.js \
      dist/test/batch.test.js dist/test/brain.test.js dist/test/debate.test.js \
      dist/test/watch.test.js
    ;;
  --integration)
    exec node --test dist/test/integration.test.js
    ;;
  all)
    exec node --test dist/test/*.test.js
    ;;
  *)
    echo "Usage: run_tests.sh [--unit|--integration]" >&2
    exit 2
    ;;
esac
