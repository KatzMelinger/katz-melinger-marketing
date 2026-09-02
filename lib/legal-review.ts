/**
 * The Legal Review queue (Diana's §3).
 *
 * The approval gate can hold a draft at `needs_legal` and notify an attorney.
 * Until now there was nowhere for that attorney to GO: the notification named a
 * draft, and seeing what was actually wrong meant opening that draft and
 * reading a findings panel that does not show any of the legal detail — which
 * claim, which authority, what the authority actually says.
 *
 * A hold with no queue is a hold that waits for someone to remember it. This is
 * the queue: everything held, oldest first, with the legal findings attached
 * and the reviewer who owns each one.
 *
 * OLDEST FIRST, NOT WORST FIRST
 *
 * Severity ordering would be the obvious choice and is the wrong one here.
 * Everything in this queue is already blocking — it is held, which is the most
 * severe state a draft has — so sorting by severity just reshuffles items that
 * are equally stuck. Age is the thing that varies and the thing that hurts: a
 * draft held for three weeks is the failure this queue exists to prevent.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { listFindings } from "./content-findings-store";
import type { StoredFinding } from "./content-findings";
import { REVIEW_AREA_LABEL, reviewAreaFor, reviewersFor, type ReviewArea } from "./legal-reviewers";

export type LegalReviewItem = {
  draftId: string;
  title: string;
  format: string | null;
  practiceArea: string | null;
  /** When the draft was last touched — how long it has been sitting. */
  heldSince: string;
  daysHeld: number;
  area: ReviewArea;
  areaLabel: string;
  /** Who owns it, then who else may clear it. */
  reviewers: { name: string; email: string }[];
  /** Open legal findings only. A resolved one is not why it is still held. */
  findings: StoredFinding[];
  /** Findings that are NOT from the legal layer but are still open and critical. */
  otherBlocking: number;
};

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * Everything currently held for legal review.
 *
 * Uses the service client because a held draft must be visible to whichever
 * attorney can clear it, not only to whoever happens to own the row. The caller
 * is responsible for having authenticated; the route does that.
 */
export async function listLegalReviewQueue(tenantId: string): Promise<LegalReviewItem[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, format, practice_area, updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "needs_legal")
    .order("updated_at", { ascending: true });

  if (error) {
    console.warn("[legal-review] queue query failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const items: LegalReviewItem[] = [];

  for (const r of rows) {
    const draftId = String(r.id);
    const all = await listFindings(draftId);

    // Open legal findings are the reason it is held. Everything else is context.
    const findings = all.filter(
      (f) => f.source === "legal" && (f.status === "open" || f.status === "in_progress"),
    );
    const otherBlocking = all.filter(
      (f) =>
        f.source !== "legal" &&
        f.severity === "critical" &&
        (f.status === "open" || f.status === "in_progress"),
    ).length;

    const practiceArea = r.practice_area === null ? null : String(r.practice_area);
    const area = reviewAreaFor({ practiceArea: practiceArea ?? undefined });
    const heldSince = String(r.updated_at ?? new Date().toISOString());

    items.push({
      draftId,
      title: String(r.title || r.topic || "Untitled"),
      format: r.format === null ? null : String(r.format),
      practiceArea,
      heldSince,
      daysHeld: daysSince(heldSince),
      area,
      areaLabel: REVIEW_AREA_LABEL[area],
      reviewers: reviewersFor({ practiceArea: practiceArea ?? undefined }).map((a) => ({
        name: a.name,
        email: a.email,
      })),
      findings,
      otherBlocking,
    });
  }

  return items;
}

/**
 * Counts for the board badge, without loading every finding.
 *
 * Separate query rather than a length on the list above: the board renders on
 * every page load and does not need the findings, and loading them would make a
 * badge cost one query per held draft.
 */
export async function legalReviewCounts(
  tenantId: string,
): Promise<{ held: number; oldestDays: number }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_drafts")
    .select("updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "needs_legal")
    .order("updated_at", { ascending: true });
  if (error) return { held: 0, oldestDays: 0 };
  const rows = (data ?? []) as { updated_at?: string }[];
  return {
    held: rows.length,
    oldestDays: rows[0]?.updated_at ? daysSince(rows[0].updated_at) : 0,
  };
}
