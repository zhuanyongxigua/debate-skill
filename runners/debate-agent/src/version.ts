// debate-agent: a thin execution adapter.
//
// This package is the only privileged surface in the repo. Keep it small and
// auditable. It owns the execution boundary (allowlists, realpath cwd, static
// argv, env allowlist, timeout, process-group kill, execution audit) and
// nothing about the debate protocol itself.

export const REQUEST_SCHEMA_VERSION = 1;
export const RESULT_SCHEMA_VERSION = 1;
