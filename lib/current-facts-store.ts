/**
 * Server-only accessor for the DB-backed current-facts list.
 *
 * Split out of lib/current-facts.ts (which is imported by client components and
 * the pure prompt helpers) so the server/DB code — and next/headers via
 * resolveTenantId — never leaks into the client build. Mirrors
 * lib/practice-areas-store.ts.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { CURRENT_FACTS, recomputeDerived, type CurrentFact } from "./current-facts";

type Row = {
  fact_key: string | null;
  label: string | null;
  value: string | null;
  jurisdiction: string | null;
  effective_date: string | null;
  keywords: string[] | null;
  unit: string | null;
  source_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
  re_verify_by: string | null;
  verify_only: boolean | null;
  derived_from: string | null;
  derived_multiplier: number | string | null;
  supersedes: string[] | null;
};

/**
 * Live current facts for a tenant, in display order. Falls back to the
 * code-seeded CURRENT_FACTS when the table is empty or unreachable, so the
 * generators and freshness gate always have values. Pass an explicit tenantId in
 * background/cron contexts.
 */
export async function getCurrentFacts(tenantId?: string): Promise<CurrentFact[]> {
  try {
    const tid = tenantId ?? (await resolveTenantId());
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("current_facts")
      .select(
        "fact_key, label, value, jurisdiction, effective_date, keywords, unit, source_url, verified_by, verified_at, re_verify_by, verify_only, derived_from, derived_multiplier, supersedes",
      )
      .eq("tenant_id", tid)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return recomputeDerived([...CURRENT_FACTS]);
    const facts = (data as Row[])
      .map((r): CurrentFact | null => {
        const id = (r.fact_key ?? "").trim();
        const label = (r.label ?? "").trim();
        const value = (r.value ?? "").trim();
        if (!id || !label || !value) return null;
        return {
          id,
          label,
          value,
          jurisdiction: (r.jurisdiction ?? "").trim(),
          effectiveDate: (r.effective_date ?? "").trim(),
          keywords: Array.isArray(r.keywords)
            ? r.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map((k) => k.trim())
            : [],
          unit: (r.unit ?? "").trim(),
          sourceUrl: (r.source_url ?? "").trim(),
          verifiedBy: (r.verified_by ?? "").trim(),
          verifiedAt: (r.verified_at ?? "").trim(),
          reVerifyBy: (r.re_verify_by ?? "").trim(),
          verifyOnly: r.verify_only === true,
          supersedes: Array.isArray(r.supersedes)
            ? r.supersedes.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            : [],
          ...derivedOf(r),
        };
      })
      .filter((f): f is CurrentFact => f !== null);
    // Recompute derived values from their sources so an annual figure can never
    // drift from the weekly one an editor just changed.
    return facts.length > 0 ? recomputeDerived(facts) : recomputeDerived([...CURRENT_FACTS]);
  } catch {
    return recomputeDerived([...CURRENT_FACTS]);
  }
}

/** The `derived` link on a row, or nothing when the row is independently sourced. */
function derivedOf(r: Row): Pick<CurrentFact, "derived"> | Record<string, never> {
  const fromFactId = (r.derived_from ?? "").trim();
  if (!fromFactId) return {};
  const multiplier = Number(r.derived_multiplier);
  if (!Number.isFinite(multiplier) || multiplier === 0) return {};
  return { derived: { fromFactId, multiplier } };
}
