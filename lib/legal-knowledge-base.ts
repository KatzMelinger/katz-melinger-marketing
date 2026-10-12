/**
 * Read access to the versioned legal knowledge base (spec 3.1).
 *
 * The table (supabase/legal_knowledge_base_schema.sql) is the maintained
 * source of truth Diana's spec describes — an attorney task to keep current,
 * not an engineering one. This module is the engineering half: cached reads
 * for the two rules built on top of it, lib/legal-named-acts.ts (3.12) and
 * lib/legal-value-check.ts (3.13).
 *
 * Cached in-memory per process for a few minutes — this table changes at most
 * a few times a year, so there is no reason to hit Supabase on every claim in
 * every draft. A cold start or a cache miss just means one extra query.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type LegalJurisdiction = "federal" | "NY" | "NJ";

export type KbThresholdEntry = {
  key: string;
  label: string;
  practiceArea: string;
  jurisdiction: LegalJurisdiction;
  region: string | null;
  /** Money units, plus the two Diana's constants needed: a deadline measured
   *  in days or years, and a coverage threshold measured in employees. */
  unit: "usd_per_hour" | "usd_per_week" | "usd_per_year" | "days" | "years" | "employees";
  currentValue: number;
  effectiveDate: string | null;
  priorValue: number | null;
  priorEffectiveDate: string | null;
  /** A figure already known but not yet in force (a January 1 minimum wage).
   *  Once its date arrives the loader makes it the current value. */
  scheduledValue: number | null;
  scheduledEffectiveDate: string | null;
  /** Terms that must appear in a sentence for this entry to apply to it. Each
   *  element is a |-separated alternation and ALL elements must match; empty
   *  means match on jurisdiction/unit/region alone. Without this, the NYSHRL
   *  administrative deadline and the NYCHRL statute of limitations are
   *  indistinguishable - both NY, both measured in years. */
  matchKeywords: string[];
  enforcementPath: string | null;
  sourceUrl: string | null;
  notes: string | null;
};

export type KbActEntry = {
  key: string;
  label: string;
  aliases: string[];
  jurisdiction: LegalJurisdiction;
  canonicalCitation: string | null;
};

type Row = {
  entry_type: "threshold" | "named_act";
  key: string;
  label: string;
  practice_area: string;
  jurisdiction: LegalJurisdiction;
  region: string | null;
  aliases: string[] | null;
  canonical_citation: string | null;
  unit: KbThresholdEntry["unit"] | null;
  current_value: number | null;
  effective_date: string | null;
  prior_value: number | null;
  prior_effective_date: string | null;
  scheduled_value?: number | null;
  scheduled_effective_date?: string | null;
  match_keywords: string[] | null;
  enforcement_path: string | null;
  source_url: string | null;
  notes: string | null;
};

let cache: { at: number; tenantId: string; rows: Row[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Drop the cached rows, so an approved change applies on the next check. */
export function clearKnowledgeBaseCache(): void {
  cache = null;
}

const BASE_COLUMNS =
  "entry_type, key, label, practice_area, jurisdiction, region, aliases, canonical_citation, unit, current_value, effective_date, prior_value, prior_effective_date, match_keywords, enforcement_path, source_url, notes";

async function loadRows(tenantId: string): Promise<Row[]> {
  if (cache && cache.tenantId === tenantId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const sb = getSupabaseAdmin();
    const read = (cols: string) => sb.from("legal_knowledge_base").select(cols).eq("tenant_id", tenantId);
    let { data, error } = await read(`${BASE_COLUMNS}, scheduled_value, scheduled_effective_date`);
    // Before supabase/rule_changes_task24.sql runs there are no scheduled columns.
    if (error && /scheduled_/.test(error.message)) ({ data, error } = await read(BASE_COLUMNS));
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Row[];
    cache = { at: Date.now(), tenantId, rows };
    return rows;
  } catch (e) {
    console.warn("[legal-knowledge-base] load failed:", e);
    // A read failure degrades to "nothing known" — 3.12/3.13 both treat that
    // as "cannot verify, route to human" rather than crashing the legal check.
    return cache?.rows ?? [];
  }
}

export async function getKnownActs(tenantId?: string): Promise<KbActEntry[]> {
  const tid = tenantId ?? (await resolveTenantId());
  const rows = await loadRows(tid);
  return rows
    .filter((r) => r.entry_type === "named_act")
    .map((r) => ({
      key: r.key,
      label: r.label,
      aliases: r.aliases ?? [],
      jurisdiction: r.jurisdiction,
      canonicalCitation: r.canonical_citation,
    }));
}

/** Today in New York, as YYYY-MM-DD: the firm's legal day. */
export function todayNy(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * The values in force on `today` (Task 24: "entries with a future
 * effective_date switch automatically on that date"). Pure, so it is tested
 * without a database.
 *   - A scheduled value whose date has arrived becomes current, and the old
 *     current value becomes prior.
 *   - A current value dated in the future is not in force yet: the prior value
 *     (if any) stands in, and the dated value is treated as scheduled. With no
 *     prior value it keeps its figure and is marked scheduled.
 */
export function resolveDates<
  R extends {
    current_value: number;
    effective_date: string | null;
    prior_value: number | null;
    prior_effective_date: string | null;
    scheduled_value?: number | null;
    scheduled_effective_date?: string | null;
  },
>(r: R, today: string): R | null {
  if (r.scheduled_value != null && r.scheduled_effective_date && r.scheduled_effective_date <= today) {
    r = {
      ...r,
      current_value: r.scheduled_value,
      effective_date: r.scheduled_effective_date,
      prior_value: r.current_value,
      prior_effective_date: r.effective_date,
      scheduled_value: null,
      scheduled_effective_date: null,
    };
  }
  if (r.effective_date && r.effective_date > today) {
    // Nothing earlier to stand in: the entry keeps its figure (so other
    // figures are still compared against it) and is marked scheduled.
    if (r.prior_value == null) {
      return { ...r, scheduled_value: r.current_value, scheduled_effective_date: r.effective_date };
    }
    return {
      ...r,
      current_value: r.prior_value,
      effective_date: r.prior_effective_date,
      prior_value: null,
      prior_effective_date: null,
      scheduled_value: r.current_value,
      scheduled_effective_date: r.effective_date,
    };
  }
  return r;
}

export async function getThresholds(tenantId?: string): Promise<KbThresholdEntry[]> {
  const tid = tenantId ?? (await resolveTenantId());
  const rows = await loadRows(tid);
  return rows
    .filter((r): r is Row & { unit: KbThresholdEntry["unit"]; current_value: number } =>
      r.entry_type === "threshold" && r.unit !== null && r.current_value !== null,
    )
    .map((r) => resolveDates(r, todayNy()))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({
      key: r.key,
      label: r.label,
      practiceArea: r.practice_area,
      jurisdiction: r.jurisdiction,
      region: r.region,
      unit: r.unit,
      currentValue: r.current_value,
      effectiveDate: r.effective_date,
      priorValue: r.prior_value,
      priorEffectiveDate: r.prior_effective_date,
      scheduledValue: r.scheduled_value ?? null,
      scheduledEffectiveDate: r.scheduled_effective_date ?? null,
      matchKeywords: r.match_keywords ?? [],
      enforcementPath: r.enforcement_path ?? null,
      sourceUrl: r.source_url,
      notes: r.notes,
    }));
}
