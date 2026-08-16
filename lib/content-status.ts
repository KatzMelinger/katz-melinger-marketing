/**
 * Content status vocabularies — one source of truth for the two content tables.
 *
 * These mirror the CHECK constraints in supabase/agent_content_status.sql, which
 * is the most recent migration to touch either column. Keep the three in step:
 * a status the app writes but the constraint rejects fails at the database, and
 * a status the constraint allows but the API rejects strands rows the app itself
 * creates. That second case is not hypothetical — the compliance and freshness
 * hard gates park drafts at `needs_legal`, but the drafts PATCH allowlist was
 * copied from the older content_drafts_status_pipeline.sql migration and omitted
 * it, so the API 400'd on a status its own gates had just written.
 *
 * NOTE: "valid in the database" is not the same as "a user may pick this from a
 * menu". `approved` and `published` are reachable only through the routes that
 * run the gates (/api/agent/approve and /api/content/drafts/[id]/publish); UI
 * pickers should define their own narrower selectable subset rather than
 * offering everything here.
 */

/** Every status `content_drafts.status` accepts. */
export const DRAFT_STATUSES = [
  "initial_review",
  "idea",
  "brief",
  "draft",
  "review",
  "needs_legal",
  "published",
  "approved",
  "archived",
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export function isDraftStatus(value: unknown): value is DraftStatus {
  return typeof value === "string" && (DRAFT_STATUSES as readonly string[]).includes(value);
}

/**
 * Every status `content_pipeline.status` accepts. Narrower than the draft list:
 * the pipeline board has no `initial_review` (a draft enters the board when it
 * leaves that stage) and no `archived`.
 */
export const PIPELINE_STATUSES = [
  "idea",
  "brief",
  "draft",
  "review",
  "needs_legal",
  "approved",
  "published",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return typeof value === "string" && (PIPELINE_STATUSES as readonly string[]).includes(value);
}
