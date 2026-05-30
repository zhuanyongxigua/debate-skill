// Small path helpers shared by allowlist and schema validation.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function expandUser(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve symlinks like POSIX realpath, but do not require the path to exist
 * (mirrors Python's os.path.realpath, which resolves a non-existent tail
 * lexically rather than throwing).
 */
export function realpathLenient(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}
