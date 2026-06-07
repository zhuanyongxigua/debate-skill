// Generic claim/run/respond loop for file-backed mailbox handlers. Request
// semantics live in handlers; this module only owns durable queue mechanics.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { MailboxHandler } from "./handler";
import {
  Mailbox,
  archiveProcessing,
  claimRequest,
  loadRequestObject,
  openResponseLog,
  processingIds,
  requestIds,
  requestStreamDir,
} from "./mailbox";

export interface MailboxServiceOptions {
  reloadAllow?: () => Allowlist;
}

async function processClaimedWithHandler<RequestT, ResponseT>(
  mb: Mailbox,
  id: string,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
  resume: boolean,
): Promise<void> {
  const { log, close } = openResponseLog(mb, id);
  let response: ResponseT;
  let requestDigest = handler.invalidRequestDigest;
  try {
    if (resume) log("daemon restarted while this request was in flight — attempting resume from persisted state");
    const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
    const req = handler.validate(loadRequestObject(join(mb.processingDir, `${id}.json`)), id, allowNow);
    requestDigest = handler.requestDigest(req);
    const streamDir = requestStreamDir(mb, id);
    response = await handler.run(req, { mailbox: mb, id, allow: allowNow, resume, streamDir, log });
  } catch (err) {
    log(`error: ${String(err)}`);
    response = handler.errorResponse(id, String(err));
  } finally {
    close();
  }
  handler.writeArtifacts(mb, id, response, requestDigest);
  archiveProcessing(mb, id);
}

/**
 * Process every currently-new request once (claim, run, write response).
 * `ignore` is mutated to mark ids as seen so they are never re-processed.
 */
export async function processNewMailboxRequests<RequestT, ResponseT>(
  mb: Mailbox,
  ignore: Set<string>,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
): Promise<string[]> {
  const processed: string[] = [];
  for (const id of requestIds(mb)) {
    if (ignore.has(id)) continue;
    ignore.add(id);
    if (claimRequest(mb, id) === null) continue;

    await processClaimedWithHandler(mb, id, allow, opts, handler, false);
    processed.push(id);
  }
  return processed;
}

/** Recover requests left in processing/ by a previous crash/restart. */
export async function recoverMailboxOrphans<RequestT, ResponseT>(
  mb: Mailbox,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
): Promise<string[]> {
  const recovered: string[] = [];
  for (const id of processingIds(mb)) {
    if (!existsSync(join(mb.responsesDir, `${id}.json`))) {
      await processClaimedWithHandler(mb, id, allow, opts, handler, true);
      recovered.push(id);
    }
    archiveProcessing(mb, id);
  }
  return recovered;
}
