/**
 * Tracked SEO target keywords, persisted in Supabase.
 *
 * The seo_target_keywords table is the source of truth. On the very first
 * read against a fresh DB we seed the fallback list AND a marker row so we
 * can distinguish "never seeded" from "user removed everything" — without
 * the marker, removing a fallback keyword would silently come back on next
 * reload because the empty-table branch kept re-injecting them.
 *
 * Mirrors the lib/seo-competitors.ts pattern.
 */

import { getSupabaseAdmin, getSupabaseServer } from "./supabase-server";

const FALLBACK_TARGETS = [
  "new york employment lawyer",
  "wage theft attorney nyc",
  "wrongful termination lawyer ny",
  "workplace discrimination attorney",
  "sexual harassment lawyer nyc",
  "overtime pay lawyer new york",
  "fmla retaliation attorney",
  "whistleblower lawyer new york",
];

const SEED_MARKER = "__seeded__";

export function normalizeKeyword(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function envTargets(): string[] {
  const raw = process.env.SEO_TARGET_KEYWORDS ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((k) => normalizeKeyword(k))
    .filter(Boolean);
}

export async function listTargets(): Promise<string[]> {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return Array.from(new Set([...FALLBACK_TARGETS, ...envTargets()])).sort();
  }
  const { data, error } = await supabase
    .from("seo_target_keywords")
    .select("keyword");
  if (error || !data) {
    return Array.from(new Set([...FALLBACK_TARGETS, ...envTargets()])).sort();
  }

  const hasSeedMarker = data.some((r) => (r as { keyword: string }).keyword === SEED_MARKER);

  if (!hasSeedMarker) {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const initial = Array.from(new Set([...FALLBACK_TARGETS, ...envTargets()]));
    const rows = [
      { keyword: SEED_MARKER, source: "system", added_at: now },
      ...initial.map((k) => ({ keyword: k, source: "system", added_at: now })),
    ];
    await admin
      .from("seo_target_keywords")
      .upsert(rows, { onConflict: "keyword" });
    return initial.sort();
  }

  return (data as { keyword: string }[])
    .map((r) => r.keyword)
    .filter((k) => k !== SEED_MARKER)
    .sort();
}

export type AddResult = { ok: boolean; keyword: string; reason?: string };

export async function addTarget(
  rawKeyword: string,
  source: "manual" | "suggested" = "manual",
): Promise<AddResult> {
  const keyword = normalizeKeyword(rawKeyword);
  if (!keyword || keyword.length < 2) {
    return { ok: false, keyword, reason: "Keyword is too short" };
  }
  if (keyword.length > 120) {
    return { ok: false, keyword, reason: "Keyword is too long (max 120 chars)" };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_target_keywords")
    .upsert(
      { keyword, source, added_at: new Date().toISOString() },
      { onConflict: "keyword" },
    );
  if (error) {
    return { ok: false, keyword, reason: error.message };
  }
  return { ok: true, keyword };
}

export async function removeTarget(
  rawKeyword: string,
): Promise<{ ok: boolean; keyword: string; reason?: string }> {
  const keyword = normalizeKeyword(rawKeyword);
  if (!keyword) return { ok: false, keyword, reason: "Invalid keyword" };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_target_keywords")
    .delete()
    .eq("keyword", keyword);
  if (error) return { ok: false, keyword, reason: error.message };
  return { ok: true, keyword };
}
