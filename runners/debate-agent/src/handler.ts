// Generic mailbox handler contracts. Keep this layer free of debate/delegate
// strategy so a sandboxed skill can submit a high-level request while the daemon
// dispatches it through a narrow, typed handler outside the sandbox.

import { Allowlist } from "./allowlist";
import { Mailbox } from "./mailbox";

export interface ResourceBudget {
  maxConcurrent: number;
  maxMinutes: number | null;
}

export interface HandlerRunContext {
  mailbox: Mailbox;
  id: string;
  allow: Allowlist;
  resume: boolean;
  streamDir: string;
  log: (line: string) => void;
  // Optional cancellation signal. When aborted, the handler should stop
  // launching new work and return a cancelled response. The abort is triggered
  // externally (by the daemon's cancel-dir scan), never from within the handler.
  signal?: AbortSignal;
}

export interface MailboxHandler<RequestT, ResponseT> {
  kind: string;
  mailboxName: string;
  resourceBudget: ResourceBudget;
  invalidRequestDigest: string;
  validate(raw: Record<string, unknown>, id: string, allow: Allowlist): RequestT;
  requestDigest(req: RequestT): string;
  run(req: RequestT, ctx: HandlerRunContext): Promise<ResponseT>;
  errorResponse(id: string, message: string): ResponseT;
  writeArtifacts(mailbox: Mailbox, id: string, response: ResponseT, requestDigest: string): void;
}
