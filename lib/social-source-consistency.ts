/**
 * Source-consistency check — spec 6.14's "flag when a claim carried into the
 * post is one another live KM page contradicts, naming both URLs; seed known
 * contradictions as traps."
 *
 * Same posture as content_known_traps.ts (which this deliberately mirrors,
 * not reuses — see supabase/content_source_contradictions_schema.sql for
 * why): a pattern match is a SUSPICION for a reviewer, not a verdict. This
 * starts with zero seeded rows — no specific contradiction has been
 * confirmed yet, so there is nothing here to check against until the team
 * adds one. That is a correct empty state, not a bug: the mechanism working
 * with no data is exactly what "seed known contradictions as traps" implies
 * — the seeding is content curation, done over time as real contradictions
 * are caught, the same loop content_known_traps already runs.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type ContradictionRow = {
  label: string;
  matchType: "phrase" | "regex";
  pattern: string;
  contradictingUrl: string;
  contradictingSummary: string;
  severity: "critical" | "important";
};

export type ContradictionHit = {
  label: string;
  contradictingUrl: string;
  contradictingSummary: string;
  severity: "critical" | "important";
};

let cache: { at: number; tenantId: string; rows: ContradictionRow[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadRows(tenantId: string): Promise<ContradictionRow[]> {
  if (cache && cache.tenantId === tenantId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("content_source_contradictions")
      .select("label, match_type, pattern, contradicting_url, contradicting_summary, severity")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      label: String(r.label),
      matchType: r.match_type === "regex" ? ("regex" as const) : ("phrase" as const),
      pattern: String(r.pattern),
      contradictingUrl: String(r.contradicting_url),
      contradictingSummary: String(r.contradicting_summary),
      severity: r.severity === "critical" ? ("critical" as const) : ("important" as const),
    }));
    cache = { at: Date.now(), tenantId, rows };
    return rows;
  } catch (e) {
    // Table not migrated yet, or unreachable — degrade to "nothing to check",
    // same posture as every other knowledge-base read in this layer.
    console.warn("[social-source-consistency] load failed:", e);
    return cache?.rows ?? [];
  }
}

function matches(row: ContradictionRow, body: string): boolean {
  if (row.matchType === "phrase") return body.toLowerCase().includes(row.pattern.toLowerCase());
  try {
    return new RegExp(row.pattern, "i").test(body);
  } catch {
    return false; // a malformed pattern is a data problem, not a false alarm
  }
}

export async function findSourceContradictions(
  body: string,
  tenantId?: string,
): Promise<ContradictionHit[]> {
  if (!body?.trim()) return [];
  const tid = tenantId ?? (await resolveTenantId());
  const rows = await loadRows(tid);
  return rows
    .filter((r) => matches(r, body))
    .map((r) => ({
      label: r.label,
      contradictingUrl: r.contradictingUrl,
      contradictingSummary: r.contradictingSummary,
      severity: r.severity,
    }));
}
