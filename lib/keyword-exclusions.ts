/**
 * Diana-managed keyword exclusion list, persisted in Supabase.
 *
 * The seo_keyword_exclusions table is the user-editable blocklist that sits on
 * top of the built-in, code-defined filters in lib/keyword-filter.ts. A keyword
 * whose text contains any term here is excluded from the SEO Opportunity Radar.
 *
 * Two effects when a term is added/removed:
 *   1. Future syncs/imports honor it — the terms are loaded into the filter's
 *      FilterContext (see /api/seo/opportunities/sync + /import).
 *   2. Existing rows are updated immediately — addExclusion() flips matching
 *      seo_opportunities rows to excluded right away (so Diana sees them leave
 *      the actionable list without a re-sync); removeExclusion() restores the
 *      rows it had excluded. Reversal is precise because we tag the row's
 *      exclude_reason with the exact term ("Custom: <term>").
 */

import { getSupabaseAdmin, getSupabaseServer } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type KeywordExclusion = { id: string; term: string; reason: string | null };

/** Normalize a term the same way keywords are normalized: trim + lower-case. */
export function normalizeTerm(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The reason string written onto an opportunity row excluded by a custom term. */
function customReason(term: string): string {
  return `Custom: ${term}`;
}

/** Escape LIKE wildcards so a term with % or _ matches literally. */
function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, (m) => `\\${m}`);
}

export async function listKeywordExclusions(
  tenantId?: string,
): Promise<KeywordExclusion[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("seo_keyword_exclusions")
    .select("id, term, reason")
    .eq("tenant_id", tid)
    .order("added_at", { ascending: false });
  if (error || !data) return [];
  return data as KeywordExclusion[];
}

/** Just the terms, for building the filter's FilterContext. */
export async function listExclusionTerms(tenantId?: string): Promise<string[]> {
  const rows = await listKeywordExclusions(tenantId);
  return rows.map((r) => r.term).filter(Boolean);
}

export type AddExclusionResult = {
  ok: boolean;
  term: string;
  excludedCount?: number;
  reason?: string;
};

export async function addKeywordExclusion(
  rawTerm: string,
  note?: string,
  tenantId?: string,
): Promise<AddExclusionResult> {
  const term = normalizeTerm(rawTerm);
  if (term.length < 2) {
    return { ok: false, term, reason: "Term must be at least 2 characters" };
  }
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("seo_keyword_exclusions").upsert(
    {
      tenant_id: tid,
      term,
      reason: note?.trim() || null,
      source: "manual",
      added_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,term" },
  );
  if (error) return { ok: false, term, reason: error.message };

  // Apply to existing opportunities right now: flip matching, not-yet-excluded
  // rows. We only touch excluded=false rows so we never clobber another rule's
  // reason, and we tag with the exact term so removal can reverse it precisely.
  let excludedCount = 0;
  const { data: updated } = await supabase
    .from("seo_opportunities")
    .update({ excluded: true, exclude_reason: customReason(term) })
    .eq("tenant_id", tid)
    .ilike("keyword", `%${escapeLike(term)}%`)
    .eq("excluded", false)
    .select("id");
  excludedCount = updated?.length ?? 0;

  return { ok: true, term, excludedCount };
}

export async function removeKeywordExclusion(
  rawTerm: string,
  tenantId?: string,
): Promise<{ ok: boolean; term: string; restoredCount?: number; reason?: string }> {
  const term = normalizeTerm(rawTerm);
  if (!term) return { ok: false, term, reason: "Empty term" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("seo_keyword_exclusions")
    .delete()
    .eq("tenant_id", tid)
    .eq("term", term);
  if (error) return { ok: false, term, reason: error.message };

  // Restore the rows this term had excluded (matched by the exact reason tag).
  const { data: restored } = await supabase
    .from("seo_opportunities")
    .update({ excluded: false, exclude_reason: null })
    .eq("tenant_id", tid)
    .eq("exclude_reason", customReason(term))
    .select("id");

  return { ok: true, term, restoredCount: restored?.length ?? 0 };
}
