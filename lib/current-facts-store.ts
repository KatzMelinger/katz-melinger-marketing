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
import { CURRENT_FACTS, type CurrentFact } from "./current-facts";

type Row = {
  fact_key: string | null;
  label: string | null;
  value: string | null;
  jurisdiction: string | null;
  effective_date: string | null;
  keywords: string[] | null;
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
      .select("fact_key, label, value, jurisdiction, effective_date, keywords")
      .eq("tenant_id", tid)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return [...CURRENT_FACTS];
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
        };
      })
      .filter((f): f is CurrentFact => f !== null);
    return facts.length > 0 ? facts : [...CURRENT_FACTS];
  } catch {
    return [...CURRENT_FACTS];
  }
}
