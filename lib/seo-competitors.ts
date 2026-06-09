/**
 * Tracked-competitor list, persisted in Supabase.
 *
 * The seo_tracked_competitors table is the source of truth. On the very first
 * read against a fresh DB we seed the fallback list AND a marker row so we
 * can distinguish "never seeded" from "user removed everything" — without the
 * marker, removing a fallback competitor would silently come back on next
 * reload because the empty-table branch kept re-injecting them.
 *
 * Once the marker exists, the DB drives the UI 1:1, including all the way
 * down to zero entries.
 */

import { getSupabaseAdmin, getSupabaseServer } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

const FALLBACK_COMPETITORS = [
  "nilawfirm.com",
  "outtengolden.com",
  "nysplaw.com",
  "employeerightslaw.com",
];

const SEED_MARKER = "__seeded__";

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function envCompetitors(): string[] {
  const raw = process.env.SEO_COMPETITOR_DOMAINS ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((d) => normalizeDomain(d))
    .filter(Boolean);
}

export async function listCompetitors(tenantId?: string): Promise<string[]> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()])).sort();
  }
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("seo_tracked_competitors")
    .select("domain")
    .eq("tenant_id", tid);
  if (error || !data) {
    return Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()])).sort();
  }

  const hasSeedMarker = data.some((r) => (r as { domain: string }).domain === SEED_MARKER);

  if (!hasSeedMarker) {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const initial = Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()]));
    const rows = [
      { domain: SEED_MARKER, source: "env_seed", added_at: now, tenant_id: tid },
      ...initial.map((d) => ({ domain: d, source: "env_seed", added_at: now, tenant_id: tid })),
    ];
    const { error: seedError } = await admin
      .from("seo_tracked_competitors")
      .upsert(rows, { onConflict: "tenant_id,domain" });
    if (seedError) {
      console.error("[seo-competitors] seed upsert failed:", seedError.message);
    }
    return initial.sort();
  }

  return (data as { domain: string }[])
    .map((r) => r.domain)
    .filter((d) => d !== SEED_MARKER)
    .sort();
}

export type AddResult = { ok: boolean; domain: string; reason?: string };

export async function addCompetitor(
  rawDomain: string,
  source: "manual" | "suggested" = "manual",
  tenantId?: string,
): Promise<AddResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes(".")) {
    return { ok: false, domain, reason: "Invalid domain" };
  }
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_tracked_competitors")
    .upsert({ domain, source, added_at: new Date().toISOString(), tenant_id: tid }, { onConflict: "tenant_id,domain" });
  if (error) {
    return { ok: false, domain, reason: error.message };
  }
  return { ok: true, domain };
}

export async function removeCompetitor(rawDomain: string, tenantId?: string): Promise<{ ok: boolean; domain: string; reason?: string }> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, domain, reason: "Invalid domain" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_tracked_competitors")
    .delete()
    .eq("domain", domain)
    .eq("tenant_id", tid);
  if (error) return { ok: false, domain, reason: error.message };
  return { ok: true, domain };
}
