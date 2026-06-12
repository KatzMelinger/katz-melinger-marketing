/**
 * Legal-directory tracker, persisted in Supabase (seo_legal_directories).
 *
 * A directory is a legal-specific listing site (Avvo, Justia, FindLaw,
 * Martindale, a state bar, etc.) where the firm should have a claimed,
 * accurate profile for authority + referral traffic. The team manages listing
 * status by hand; suggestDirectories() asks Claude which directories matter for
 * the firm's practice areas and drafts listing copy — the "no API cost" half of
 * the hybrid. A future DataForSEO Business Listings scan can upsert rows with
 * source 'scan' without touching this contract.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export type DirectoryStatus =
  | "not_listed"
  | "in_progress"
  | "listed"
  | "claimed"
  | "needs_update";

export type DirectoryCategory = "general" | "practice" | "local" | "bar";

export interface DirectoryRow {
  id: string;
  name: string;
  url: string | null;
  category: DirectoryCategory | string;
  status: DirectoryStatus | string;
  listing_url: string | null;
  priority: "high" | "medium" | "low" | string;
  notes: string | null;
  source: string;
  updated_at: string;
}

const SELECT_COLS =
  "id, name, url, category, status, listing_url, priority, notes, source, updated_at";

export async function listDirectories(tenantId?: string): Promise<DirectoryRow[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("seo_legal_directories")
    .select(SELECT_COLS)
    .eq("tenant_id", tid)
    .order("priority", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data as DirectoryRow[];
}

export type MutationResult = { ok: boolean; row?: DirectoryRow; reason?: string };

export interface DirectoryInput {
  name: string;
  url?: string | null;
  category?: DirectoryCategory | string;
  priority?: "high" | "medium" | "low" | string;
  status?: DirectoryStatus | string;
  listing_url?: string | null;
  notes?: string | null;
  source?: string;
}

export async function addDirectory(
  input: DirectoryInput,
  tenantId?: string,
): Promise<MutationResult> {
  const name = (input.name || "").trim();
  if (!name) return { ok: false, reason: "Directory name is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("seo_legal_directories")
    .upsert(
      {
        tenant_id: tid,
        name,
        url: input.url ?? null,
        category: input.category ?? "general",
        priority: input.priority ?? "medium",
        status: input.status ?? "not_listed",
        listing_url: input.listing_url ?? null,
        notes: input.notes ?? null,
        source: input.source ?? "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,name" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, row: data as DirectoryRow };
}

export async function updateDirectory(
  id: string,
  patch: Partial<DirectoryInput>,
  tenantId?: string,
): Promise<MutationResult> {
  if (!id) return { ok: false, reason: "id is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["name", "url", "category", "priority", "status", "listing_url", "notes"] as const) {
    if (key in patch) update[key] = patch[key];
  }
  const { data, error } = await supabase
    .from("seo_legal_directories")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", tid)
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, row: data as DirectoryRow };
}

export async function removeDirectory(
  id: string,
  tenantId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!id) return { ok: false, reason: "id is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_legal_directories")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tid);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// --- AI suggestions --------------------------------------------------------

export interface SuggestedDirectory {
  name: string;
  url: string;
  category: DirectoryCategory;
  priority: "high" | "medium" | "low";
  reason: string;
  suggestedDescription: string;
}

const SUGGEST_SYSTEM = `You are a legal-marketing strategist who specializes in local SEO and directory/citation building for law firms. Given a firm's practice areas and geography, recommend the legal and business directories where the firm should have a claimed, accurate, optimized profile.

Cover these directory types:
- GENERAL legal directories every firm should be on (Avvo, Justia, FindLaw, Martindale-Hubbell, Lawyers.com, Nolo, Super Lawyers, Justia, HG.org).
- PRACTICE-specific directories relevant to the firm's actual practice areas (e.g. employment-law or plaintiff-side directories) — only suggest ones that genuinely fit the practice areas given.
- LOCAL/general business citations that matter for map-pack and NAP consistency (Google Business Profile, Bing Places, Yelp, Apple Business Connect, Better Business Bureau).
- BAR association directories for the firm's state(s).

For each, give the real listing/homepage URL, a one-line reason it matters for THIS firm, and a short (1-2 sentence) suggested profile description written in the firm's voice using its real practice areas and geography. Never fabricate the firm's contact details — leave a placeholder if you don't have them.

Return ONLY a JSON object, no markdown fences:
{
  "directories": [
    {
      "name": "Avvo",
      "url": "https://www.avvo.com",
      "category": "general" | "practice" | "local" | "bar",
      "priority": "high" | "medium" | "low",
      "reason": "why it matters for this firm",
      "suggestedDescription": "short profile blurb in the firm's voice"
    }
  ]
}

Order by priority (high first). Aim for 10-16 high-signal suggestions, not an exhaustive dump.`;

export async function suggestDirectories(
  tenantId?: string,
): Promise<SuggestedDirectory[]> {
  const tid = tenantId ?? (await resolveTenantId());
  const firmContext = await getFirmContext(tid);

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4000,
    system: SUGGEST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Recommend the legal + business directories this firm should be listed on.\n\nFIRM CONTEXT:\n${firmContext}\n\nReturn ONLY the JSON object.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const parsed = extractJSON<{ directories?: SuggestedDirectory[] }>(text);
  return Array.isArray(parsed.directories) ? parsed.directories : [];
}
