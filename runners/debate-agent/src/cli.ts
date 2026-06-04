// Command-line surface: run | run-batch | validate | watch | print-rules.

import { AllowlistError, defaultConfigPath, loadAllowlist, safeReloadAllowlist } from "./allowlist";
import { runBatchFile, runRequestFile } from "./runner";
import { RequestRejected, loadRequestDict, validateRequest } from "./schema";
import { watchLoop } from "./watch";

const rulesTemplate = (path: string): string =>
  `# ~/.codex/rules/default.rules
# Allow ONLY the fixed runner path outside the parent Codex sandbox.
# Use decision = "allow" only for unattended automation.
prefix_rule(
    pattern = ["${path}"],
    decision = "prompt",
    justification = "Allow only the controlled debate agent outside the parent Codex sandbox.",
)
`;

interface ParsedArgs {
  config?: string;
  command?: string;
  request?: string;
  path?: string;
  planner?: string;
  error?: string;
}

function parse(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  let i = 0;
  // Global flags before the subcommand.
  while (i < argv.length && argv[i]!.startsWith("--")) {
    const flag = argv[i]!;
    if (flag === "--config") {
      out.config = argv[++i];
      i++;
    } else {
      out.error = `unknown global flag: ${flag}`;
      return out;
    }
  }
  if (i >= argv.length) return out;
  out.command = argv[i++];
  // Subcommand flags.
  while (i < argv.length) {
    const flag = argv[i]!;
    if (flag === "--request") {
      out.request = argv[++i];
      i++;
    } else if (flag === "--path") {
      out.path = argv[++i];
      i++;
    } else if (flag === "--planner") {
      out.planner = argv[++i];
      i++;
    } else if (flag === "--config") {
      out.config = argv[++i];
      i++;
    } else {
      out.error = `unknown flag for ${out.command}: ${flag}`;
      return out;
    }
  }
  return out;
}

function usage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  debate-agent [--config <allowlist.json>] run       --request <request.json>",
      "  debate-agent [--config <allowlist.json>] run-batch  --request <batch.json>",
      "  debate-agent [--config <allowlist.json>] validate   --request <request.json>",
      "  debate-agent [--config <allowlist.json>] watch       [--planner claude|codex]",
      "  debate-agent print-rules [--path <installed-path>]",
      "",
    ].join("\n"),
  );
}

export async function main(argv: string[]): Promise<number> {
  const args = parse(argv);
  if (args.error) {
    process.stderr.write(args.error + "\n");
    usage();
    return 2;
  }
  if (!args.command) {
    usage();
    return 2;
  }

  try {
    if (args.command === "run") {
      if (!args.request) {
        process.stderr.write("run requires --request <request.json>\n");
        return 2;
      }
      const allow = loadAllowlist(args.config ?? defaultConfigPath());
      const result = await runRequestFile(args.request, allow);
      console.log(JSON.stringify(result, null, 2));
      return result.status === "completed" ? 0 : 1;
    }

    if (args.command === "run-batch") {
      if (!args.request) {
        process.stderr.write("run-batch requires --request <batch.json>\n");
        return 2;
      }
      const allow = loadAllowlist(args.config ?? defaultConfigPath());
      const result = await runBatchFile(args.request, allow);
      console.log(JSON.stringify(result, null, 2));
      return result.status === "completed" ? 0 : 1;
    }

    if (args.command === "validate") {
      if (!args.request) {
        process.stderr.write("validate requires --request <request.json>\n");
        return 2;
      }
      const allow = loadAllowlist(args.config ?? defaultConfigPath());
      try {
        const raw = loadRequestDict(args.request);
        const req = validateRequest(raw, allow);
        console.log(
          JSON.stringify(
            {
              status: "valid",
              run_id: req.runId,
              provider: req.provider,
              phase: req.phase,
              mode: req.mode,
              repo: req.repo,
              repo_root: req.repoRoot,
              profile: req.profile,
              timeout_seconds: req.timeoutSeconds,
              request_digest: req.requestDigest,
            },
            null,
            2,
          ),
        );
        return 0;
      } catch (err) {
        if (err instanceof RequestRejected) {
          console.log(JSON.stringify({ status: "rejected", reject_reason: err.message }, null, 2));
          return 1;
        }
        throw err;
      }
    }

    if (args.command === "watch") {
      const configPath = args.config ?? defaultConfigPath();
      const allow = loadAllowlist(configPath);
      let planner: string | undefined;
      if (args.planner !== undefined) {
        planner = args.planner;
        if (planner !== "claude" && planner !== "codex") {
          process.stderr.write(`--planner must be claude or codex, got ${planner}\n`);
          return 2;
        }
        // Fail closed: an explicit daemon default planner must be allowed by the
        // same allowlist as the workers. If --planner is omitted, each request may
        // supply planner_provider; requests without it still default to claude and
        // are checked per request.
        if (!allow.providers.includes(planner)) {
          process.stderr.write(
            `--planner ${planner} is not in the allowlist providers (${allow.providers.join(", ")}); ` +
              `add it to providers or pick an allowed planner\n`,
          );
          return 2;
        }
      }
      // Re-read the allowlist per request so config edits apply without a restart.
      // A bad/half-saved edit falls back to the last-good config (never throws).
      let lastGood = allow;
      const reloadAllow = configPath
        ? (): typeof allow => {
            lastGood = safeReloadAllowlist(configPath, lastGood, (m) => process.stderr.write(`  ${m}\n`));
            return lastGood;
          }
        : undefined;
      await watchLoop(allow, { plannerProvider: planner, reloadAllow }); // runs until killed
      return 0; // unreachable
    }

    if (args.command === "print-rules") {
      console.log(rulesTemplate(args.path ?? "/Users/<you>/.local/bin/debate-agent"));
      return 0;
    }

    process.stderr.write(`unknown command: ${args.command}\n`);
    usage();
    return 2;
  } catch (err) {
    if (err instanceof AllowlistError) {
      console.log(JSON.stringify({ status: "error", error: `allowlist config: ${err.message}` }, null, 2));
      return 2;
    }
    throw err;
  }
}
