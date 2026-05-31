// Static provider->argv mapping and env allowlist.
//
// This file is the runner's own static launch surface. It deliberately does NOT
// import cli-launch and does NOT execute arbitrary launch specs. It mirrors
// the shape of skills/cli-launch Provider Defaults by hand so the privileged
// surface stays self-contained and reviewable. Keep them in sync intentionally.
//
// Hardening choices that differ from cli-launch on purpose:
//   - the prompt is transported on the child's stdin (claude/codex), never as a
//     bare argv element, so it cannot be misparsed as a flag. Copilot has no
//     documented stdin prompt entry, so its prompt is bound to a single
//     `-p <text>` argv element (one token => still no flag injection; redacted
//     in the display command, though visible in `ps`);
//   - the child env is rebuilt from an allowlist, dropping secret-bearing vars.

// Non-secret environment variables that may be copied into the child. PATH and
// HOME are required for the CLIs to find their binary and default account
// config (~/.claude, ~/.codex). Everything else here is locale/terminal
// plumbing.
const ENV_KEEP_EXACT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "COLUMNS",
  "LINES",
]);
// Prefix-matched keep list (locale + XDG base dirs).
const ENV_KEEP_PREFIXES = ["LC_", "XDG_"];

// Belt-and-suspenders denylist. The keep allowlist already excludes these, but
// we drop them explicitly and report them so children fall back to the default
// logged-in account config rather than any injected credential.
const ENV_SECRET_DENY = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCP_SERVICE_ACCOUNT_KEY",
  "SSH_AUTH_SOCK",
  "NPM_TOKEN",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  // Account-redirect vars: dropping them forces the default config dir.
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  // Copilot permission-escalation env: drop so a parent `COPILOT_ALLOW_ALL`
  // can never override the runner's conservative per-capability tool flags.
  "COPILOT_ALLOW_ALL",
]);

export interface ChildLaunch {
  provider: string;
  argv: string[];
  displayCommand: string; // prompt redacted
  stdin: string; // the prompt; written to the child only when promptTransport === "stdin"
  promptTransport: "stdin" | "argv";
  cwd: string;
  env: Record<string, string>;
  strippedEnvKeys: string[];
}

export function buildChildEnv(
  baseEnv: Record<string, string | undefined>,
): { env: Record<string, string>; stripped: string[] } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (ENV_SECRET_DENY.has(key)) continue;
    if (ENV_KEEP_EXACT.has(key) || ENV_KEEP_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  const stripped = Object.keys(baseEnv)
    .filter((k) => ENV_SECRET_DENY.has(k))
    .sort();
  return { env, stripped };
}

// Read-only Claude posture (Claude has no OS sandbox, so this is a harness-level
// permission boundary, not a kernel guarantee). We DENY the mutating tools, and
// ALLOW only read tools plus a small set of read-only `git` subcommands so a
// review worker can actually see what changed (Read/Grep/Glob alone cannot run
// `git diff`). Each entry MUST be its own argv element — the `Bash(git diff:*)`
// patterns contain a space, so a single space-joined string would split them.
//   Verified safe: with these flags + `--permission-mode default`, claude runs
//   `git diff` but writes (Write/Edit) and arbitrary Bash (e.g. `echo > file`,
//   `tee`) are denied (no approval in --print) — neither /tmp nor cwd is writable.
// Residual: read-only git still trusts the repo's own git config/attributes
// (e.g. a malicious `diff.external`); prefer codex (OS sandbox) for untrusted repos.
const CLAUDE_DENY_WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const CLAUDE_READONLY_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git blame:*)",
];

function buildClaudeArgv(capability: string, effort: string, jsonSchema?: string): string[] {
  // Mirrors cli-launch Claude Code defaults: print mode, prompt via stdin. Thinking
  // `effort` is per-launch (the planner picks it; the planner itself runs xhigh).
  // Claude profiles are unsupported (caller fails closed before reaching here).
  // read_only_review denies writes and allows only read tools + read-only git;
  // workspace_write auto-accepts edits.
  //
  // Claude is EXEMPT from fast/turbo mode (like copilot): Claude's fast mode needs
  // an API token, but the runner strips API keys and runs the child on the default
  // logged-in account config, so a fast flag could not take effect. Only codex
  // honors `fast`.
  const permissionMode = capability === "workspace_write" ? "acceptEdits" : "default";
  const argv = ["claude", "--print", "--permission-mode", permissionMode, "--effort", effort];
  if (capability !== "workspace_write") {
    argv.push("--disallowedTools", ...CLAUDE_DENY_WRITE_TOOLS);
    argv.push("--allowedTools", ...CLAUDE_READONLY_TOOLS);
  }
  if (jsonSchema) {
    // Planner: constrain the final result to a JSON Schema. `--json-schema` needs
    // `--output-format json`; the validated object arrives in the envelope's
    // `structured_output` field (the runner reads it back).
    argv.push("--output-format", "json", "--json-schema", jsonSchema);
  } else {
    // Worker: stream JSON events so a slow/long worker can be tailed live (the
    // runner appends the stream to a debug file and extracts the final `result`).
    argv.push("--output-format", "stream-json", "--verbose");
  }
  return argv;
}

function buildCodexArgv(
  cwd: string,
  profile: string | null,
  capability: string,
  effort: string,
  fast: boolean,
  schemaFile?: string,
  outputFile?: string,
): string[] {
  // Mirrors cli-launch Codex CLI defaults: exec mode, approvals never, prompt
  // via stdin (the trailing "-"). Thinking `effort` is per-launch (the planner
  // picks it; codex is fast/cheap so it generally uses xhigh). read_only_review
  // uses the read-only sandbox with no network; workspace_write uses the writable
  // sandbox with network.
  const argv = ["codex"];
  if (profile) {
    argv.push("--profile", profile);
  }
  argv.push("--ask-for-approval", "never", "-c", `model_reasoning_effort="${effort}"`);
  // Fast/turbo mode via per-invocation -c overrides (no global config change).
  if (fast) argv.push("-c", 'service_tier="fast"', "-c", "features.fast_mode=true");
  if (capability === "workspace_write") {
    argv.push(
      "-c",
      "sandbox_workspace_write.network_access=true",
      "exec",
      "--sandbox",
      "workspace-write",
    );
  } else {
    argv.push("exec", "--sandbox", "read-only");
  }
  // Planner only: constrain the final message to a JSON Schema file and capture
  // it to an output file (the runner reads that file back as the plan).
  if (schemaFile) argv.push("--output-schema", schemaFile);
  if (outputFile) argv.push("-o", outputFile);
  argv.push("--color", "never", "-C", cwd, "-");
  return argv;
}

function buildCopilotArgv(cwd: string, capability: string, prompt: string): string[] {
  // The standalone GitHub Copilot CLI (opt-in; off by default). It has no OS
  // filesystem sandbox like Codex, so the runner never grants it arbitrary
  // shell, all-paths, or all-urls. read_only_review denies the mutating tools;
  // workspace_write permits file edits scoped to the cwd but still denies shell.
  // The prompt is bound to a single `-p` argv element (no documented stdin).
  const argv = ["copilot", "--no-color", "-C", cwd];
  if (capability === "workspace_write") {
    argv.push("--add-dir", cwd, "--allow-tool=write", "--deny-tool=shell");
  } else {
    argv.push("--deny-tool=write", "--deny-tool=shell");
  }
  argv.push("-p", prompt);
  return argv;
}

export function buildChildLaunch(args: {
  provider: string;
  cwd: string;
  profile: string | null;
  capability: string;
  prompt: string;
  baseEnv: Record<string, string | undefined>;
  effort?: string; // thinking effort (per-launch; default "high"). copilot has none.
  fast?: boolean;
  // Planner-only structured-output (the runner reads the validated plan back):
  jsonSchema?: string; // claude: inline `--json-schema` (with `--output-format json`)
  codexSchemaFile?: string; // codex: `--output-schema <file>`
  codexOutputFile?: string; // codex: `-o <file>` (final message written here)
}): ChildLaunch {
  const { provider, cwd, profile, capability, prompt, baseEnv, effort = "high", fast = false, jsonSchema, codexSchemaFile, codexOutputFile } = args;

  let argv: string[];
  let promptTransport: "stdin" | "argv";
  if (provider === "claude") {
    // Defense in depth: schema already rejects Claude profiles, but never
    // silently drop one here either.
    if (profile !== null) {
      throw new Error("claude profile is not supported by this runner");
    }
    argv = buildClaudeArgv(capability, effort, jsonSchema); // claude is fast-exempt (needs an API token)
    promptTransport = "stdin";
  } else if (provider === "codex") {
    argv = buildCodexArgv(cwd, profile, capability, effort, fast, codexSchemaFile, codexOutputFile);
    promptTransport = "stdin";
  } else if (provider === "copilot") {
    // copilot is exempt from fast mode (no clean per-invocation fast flag).
    if (profile !== null) {
      throw new Error("copilot profile is not supported by this runner");
    }
    argv = buildCopilotArgv(cwd, capability, prompt);
    promptTransport = "argv";
  } else {
    // Should never happen: schema validation already enforces the allowlist.
    throw new Error(`no static argv builder for provider ${JSON.stringify(provider)}`);
  }

  const { env, stripped } = buildChildEnv(baseEnv);
  const displayCommand =
    promptTransport === "stdin"
      ? argv.join(" ") + " <stdin-prompt>"
      : argv.map((a) => (a === prompt ? "<prompt>" : a)).join(" ");
  return {
    provider,
    argv,
    displayCommand,
    stdin: prompt,
    promptTransport,
    cwd,
    env,
    strippedEnvKeys: stripped,
  };
}
