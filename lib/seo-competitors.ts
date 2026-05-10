/**
 * Tracked-competitor list, persisted in Supabase.
 *
 * Previously this lived in a process-global Set seeded from env vars +
 * hardcoded defaults — meaning every Vercel cold boot lost any competitors
 * the user had added through the UI. The seo_tracked_competitors table now
 * holds them durably.
 *
 * Falls back to the env var SEO_COMPETITOR_DOMAINS (comma-separated) +
 * legacy defaults only on a totally fresh database — useful for a clean
 * dev clone before the seed migration runs.
 */

import { getSupabaseAdmin, getSupabaseServer } from "./supabase-server";

const FALLBACK_COMPETITORS = [
  "nilawfirm.com",
  "outtengolden.com",
  "nysplaw.com",
  "employeerightslaw.com",
];

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

export async function listCompetitors(): Promise<string[]> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()])).sort();
  }
  const { data, error } = await supabase
    .from("seo_tracked_competitors")
    .select("domain");
  if (error || !data) {
    return Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()])).sort();
  }
  if (data.length === 0) {
    return Array.from(new Set([...FALLBACK_COMPETITORS, ...envCompetitors()])).sort();
  }
  return (data as { domain: string }[]).map((r) => r.domain).sort();
}

export type AddResult = { ok: boolean; domain: string; reason?: string };

export async function addCompetitor(
  rawDomain: string,
  source: "manual" | "suggested" = "manual",
): Promise<AddResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain || !domain.includes(".")) {
    return { ok: false, domain, reason: "Invalid domain" };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_tracked_competitors")
    .upsert({ domain, source, added_at: new Date().toISOString() }, { onConflict: "domain" });
  if (error) {
    return { ok: false, domain, reason: error.message };
  }
  return { ok: true, domain };
}

export async function removeCompetitor(rawDomain: string): Promise<{ ok: boolean; domain: string; reason?: string }> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return { ok: false, domain, reason: "Invalid domain" };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_tracked_competitors")
    .delete()
    .eq("domain", domain);
  if (error) return { ok: false, domain, reason: error.message };
  return { ok: true, domain };
}
