// Execution audit writer.
//
// Audit lives under ~/.debate-agent/<run-id>/, separate from the debate-router
// protocol audit under ~/.debate-router/<run-id>/. The two are linked only by
// run_id (constraint A1). This runner never writes into ~/.debate-router/.
//
// A tiny YAML emitter is used so the runner has no third-party dependency.

import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import { expandUser } from "./paths";

// Process-local sequence so same-second launches never collide on a filename.
let seq = 0;

export function auditRoot(): string {
  const override = process.env.DEBATE_AGENT_AUDIT_HOME;
  return override ? expandUser(override) : join(homedir(), ".debate-agent");
}

export function runAuditDir(runId: string): string {
  return join(auditRoot(), runId);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = String(value);
  // Quote anything that could confuse a YAML reader.
  if (text === "" || /[:#\n"']/.test(text) || text.trim() !== text) {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  return text;
}

function emit(obj: unknown, indent = 0): string[] {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (val !== null && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length) {
        lines.push(`${pad}${key}:`);
        lines.push(...emit(val, indent + 1));
      } else if (Array.isArray(val) && val.length) {
        lines.push(`${pad}${key}:`);
        for (const item of val) lines.push(`${pad}  - ${yamlScalar(item)}`);
      } else if (val !== null && typeof val === "object") {
        lines.push(`${pad}${key}: ${Array.isArray(val) ? "[]" : "{}"}`);
      } else {
        lines.push(`${pad}${key}: ${yamlScalar(val)}`);
      }
    }
  } else {
    lines.push(`${pad}${yamlScalar(obj)}`);
  }
  return lines;
}

export function toYaml(obj: Record<string, unknown>): string {
  return emit(obj).join("\n") + "\n";
}

function timestampSlug(): string {
  // 2026-05-30T17:39:04.123Z -> 20260530T173904Z
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * Resolve the per-run audit dir and guard it against escaping the root.
 *
 * Defense in depth: schema validation already rejects '..' / leading-dot
 * run_ids, but the audit module must not write outside its root even if called
 * directly with a hostile run_id.
 */
function resolveRunDir(runId: string): string {
  const rootRaw = auditRoot();
  mkdirSync(rootRaw, { recursive: true });
  const root = realpathSync(rootRaw);
  const outDir = resolve(root, runId);
  // (1) Lexical containment: rejects '..' and absolute escapes.
  if (outDir !== root && !outDir.startsWith(root + sep)) {
    throw new Error(`run_id ${JSON.stringify(runId)} escapes the audit root ${root}`);
  }
  // (2) Symlink containment: the lexical check above is satisfied by a
  // *pre-existing symlink* at <root>/<runId> pointing elsewhere, which the
  // subsequent mkdir/openSync would happily follow (the "wx" exclusive flag only
  // guards the leaf file, not a symlinked parent dir). `root` is already a
  // realpath and runId is a single path segment, so the only symlink that can be
  // introduced is the run dir itself — reject it outright (covers dangling
  // symlinks too).
  const existing = lstatSync(outDir, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `run_id ${JSON.stringify(runId)} resolves to a symlink; refusing to write audit outside the root ${root}`,
    );
  }
  return outDir;
}

/**
 * Exclusively create a unique <stem>.yaml; return [stem, open fd].
 *
 * pid + a process-local counter make the stem unique within and across
 * same-second launches; the "wx" exclusive-create flag closes the race against
 * another process that happened to pick the same name.
 */
function openUnique(outDir: string, stemBase: string): [string, number] {
  const pid = process.pid;
  for (let i = 0; i < 100_000; i++) {
    const stem = `${stemBase}-${pid}-${seq++}`;
    const path = join(outDir, `${stem}.yaml`);
    try {
      const fd = openSync(path, "wx", 0o600);
      return [stem, fd];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(`could not allocate a unique audit path in ${outDir}`);
}

export interface AuditPaths {
  audit_path: string;
  stdout_path?: string;
  stderr_path?: string;
}

/**
 * Write the audit YAML (+ optional child stdout/stderr) for one exec.
 *
 * Each call writes a distinct set of files (one file per launched child);
 * returns the paths written, for inclusion in the result envelope.
 */
export function writeExecutionAudit(args: {
  runId: string;
  record: Record<string, unknown>;
  stdout?: string | null;
  stderr?: string | null;
  phase?: string;
  provider?: string;
}): AuditPaths {
  const { runId, record, stdout = null, stderr = null, phase = "other", provider = "unknown" } = args;

  const outDir = resolveRunDir(runId);
  mkdirSync(outDir, { recursive: true });

  const stemBase = `exec-${phase}-${provider}-${timestampSlug()}`;
  const [stem, fd] = openUnique(outDir, stemBase);
  const fullRecord = { recorded_at: timestampSlug(), ...record };
  try {
    writeSync(fd, toYaml(fullRecord));
  } finally {
    closeSync(fd);
  }
  const auditPath = join(outDir, `${stem}.yaml`);

  const paths: AuditPaths = { audit_path: auditPath };
  if (stdout !== null) {
    const p = join(outDir, `${stem}.stdout.txt`);
    writeFileSync(p, stdout);
    paths.stdout_path = p;
  }
  if (stderr !== null) {
    const p = join(outDir, `${stem}.stderr.txt`);
    writeFileSync(p, stderr);
    paths.stderr_path = p;
  }
  return paths;
}
