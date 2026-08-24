/**
 * Which content statuses a generic PATCH is allowed to write.
 *
 * `lib/content-status.ts` answers "will the database accept this value". This
 * module answers the different question the gates actually care about: "may
 * THIS caller set it". The note at the top of content-status.ts already said
 * `approved` and `published` were "reachable only through the routes that run
 * the gates" — but nothing enforced it, so three surfaces set them directly:
 *
 *   - PATCH /api/content/drafts/[id]   accepted any DraftStatus
 *   - PATCH /api/content/pipeline/[id] accepted any PipelineStatus
 *   - Publishing QA moved review → published on the pipeline row, skipping
 *     `approved` entirely and with it the compliance and freshness gates
 *
 * That is the mechanism behind a draft reaching Approved with open critical
 * findings: the gate was never absent, it was just optional. Gated statuses are
 * now writable ONLY by the routes that run the checks, which reach the table
 * through the service client rather than back through these endpoints:
 *
 *   approved     → POST /api/agent/approve            (compliance + freshness)
 *   published    → POST /api/content/drafts/[id]/publish
 *   needs_legal  → written BY those gates when they hold an item
 *
 * `needs_legal` is gated for the opposite reason to the other two: a hold is a
 * finding, and letting a caller set it by hand would let one be faked as easily
 * as cleared. Moving OUT of a hold is done by re-running the gate, not by
 * PATCHing the status back to `draft`.
 */

/** Statuses no generic PATCH may write. Each is owned by a gated route. */
export const GATED_STATUSES = ["approved", "published", "needs_legal"] as const;

export type GatedStatus = (typeof GATED_STATUSES)[number];

export function isGatedStatus(value: unknown): value is GatedStatus {
  return typeof value === "string" && (GATED_STATUSES as readonly string[]).includes(value);
}

/** The route that owns each gated status, for the rejection message. */
const OWNER: Record<GatedStatus, string> = {
  approved:
    "POST /api/agent/approve, which re-runs the compliance and freshness gates",
  published:
    "POST /api/content/drafts/[id]/publish, which re-checks compliance at the moment of publishing",
  needs_legal:
    "the compliance and freshness gates, which set it when they hold an item",
};

/**
 * Human-readable 409 body for a rejected transition. Names the route to call
 * instead — a caller hitting this is usually a surface that should have been
 * wired to the gate, and the message is how that gets noticed.
 */
export function gatedStatusMessage(status: GatedStatus): string {
  return `"${status}" is set by ${OWNER[status]} — it cannot be assigned directly.`;
}
