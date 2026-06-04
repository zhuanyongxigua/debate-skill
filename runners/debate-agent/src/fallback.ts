// Provider fallback policy helpers.
//
// The orchestrator may re-run the SAME task on another provider when a CLI cannot
// launch or fails to produce output. Rejections are excluded because they are
// policy or validation failures, not provider availability failures.

export function isFallbackEligible(status: string, errorCategory: string | null | undefined): boolean {
  if (status === "completed") return false;
  if (status === "rejected") return false;
  if (errorCategory === "rejected") return false;
  return true;
}

export function fallbackCategory(errorCategory: string | null | undefined): string {
  return errorCategory ?? "unknown";
}
