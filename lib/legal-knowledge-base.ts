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
  unit: "usd_per_hour" | "usd_per_week" | "usd_per_year" | "days";
  currentValue: number;
  effectiveDate: string | null;
  priorValue: number | null;
  priorEffectiveDate: string | null;
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
  source_url: string | null;
  notes: string | null;
};

let cache: { at: number; tenantId: string; rows: Row[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadRows(tenantId: string): Promise<Row[]> {
  if (cache && cache.tenantId === tenantId && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("legal_knowledge_base")
      .select(
        "entry_type, key, label, practice_area, jurisdiction, region, aliases, canonical_citation, unit, current_value, effective_date, prior_value, prior_effective_date, source_url, notes",
      )
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
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

export async function getThresholds(tenantId?: string): Promise<KbThresholdEntry[]> {
  const tid = tenantId ?? (await resolveTenantId());
  const rows = await loadRows(tid);
  return rows
    .filter((r): r is Row & { unit: KbThresholdEntry["unit"]; current_value: number } =>
      r.entry_type === "threshold" && r.unit !== null && r.current_value !== null,
    )
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
      sourceUrl: r.source_url,
      notes: r.notes,
    }));
}
