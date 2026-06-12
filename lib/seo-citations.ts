/**
 * Local citation (NAP) tracker, persisted in Supabase (seo_citations).
 *
 * A citation is any place online that lists the firm's Name / Address / Phone
 * — Google Business Profile, Yelp, Bing Places, legal directories, etc. For
 * local SEO the NAP must be IDENTICAL everywhere; inconsistencies hurt map-pack
 * ranking. This module tracks what's actually live on each source and flags
 * drift from the firm's canonical NAP.
 *
 * Canonical NAP comes from the tenant's firm config (getTenantConfig) — the
 * same values edited on /brand-voice. The hybrid "no API cost" path:
 *   - Manual: record a source's NAP and mark it consistent/inconsistent.
 *   - AI: paste listing text you pulled from a site; auditCitations() extracts
 *     each source's NAP and compares it to canonical, flagging mismatches.
 * A future DataForSEO Business Listings scan can upsert rows with source_type
 * 'scan' without changing this contract.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { getTenantConfig } from "@/lib/tenant-config";
import { resolveTenantId } from "@/lib/tenant-context";

export interface CanonicalNap {
  name: string;
  address: string;
  phone: string;
}

export type CitationStatus = "consistent" | "inconsistent" | "missing" | "unverified";

export interface CitationRow {
  id: string;
  source: string;
  listing_url: string | null;
  nap_name: string | null;
  nap_address: string | null;
  nap_phone: string | null;
  status: CitationStatus | string;
  issues: string | null;
  source_type: string;
  last_checked_at: string | null;
  updated_at: string;
}

const SELECT_COLS =
  "id, source, listing_url, nap_name, nap_address, nap_phone, status, issues, source_type, last_checked_at, updated_at";

export async function getCanonicalNap(tenantId?: string): Promise<CanonicalNap> {
  const config = await getTenantConfig(tenantId);
  return {
    name: config.firmName,
    address: config.firmAddress,
    phone: config.firmPhone,
  };
}

export async function listCitations(tenantId?: string): Promise<CitationRow[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("seo_citations")
    .select(SELECT_COLS)
    .eq("tenant_id", tid)
    .order("source", { ascending: true });
  if (error || !data) return [];
  return data as CitationRow[];
}

export type CitationMutationResult = { ok: boolean; row?: CitationRow; reason?: string };

export interface CitationInput {
  source: string;
  listing_url?: string | null;
  nap_name?: string | null;
  nap_address?: string | null;
  nap_phone?: string | null;
  status?: CitationStatus | string;
  issues?: string | null;
  source_type?: string;
}

export async function addCitation(
  input: CitationInput,
  tenantId?: string,
): Promise<CitationMutationResult> {
  const source = (input.source || "").trim();
  if (!source) return { ok: false, reason: "Source is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("seo_citations")
    .upsert(
      {
        tenant_id: tid,
        source,
        listing_url: input.listing_url ?? null,
        nap_name: input.nap_name ?? null,
        nap_address: input.nap_address ?? null,
        nap_phone: input.nap_phone ?? null,
        status: input.status ?? "unverified",
        issues: input.issues ?? null,
        source_type: input.source_type ?? "manual",
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,source" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, row: data as CitationRow };
}

export async function updateCitation(
  id: string,
  patch: Partial<CitationInput>,
  tenantId?: string,
): Promise<CitationMutationResult> {
  if (!id) return { ok: false, reason: "id is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  };
  for (const key of [
    "source",
    "listing_url",
    "nap_name",
    "nap_address",
    "nap_phone",
    "status",
    "issues",
  ] as const) {
    if (key in patch) update[key] = patch[key];
  }
  const { data, error } = await supabase
    .from("seo_citations")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", tid)
    .select(SELECT_COLS)
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, row: data as CitationRow };
}

export async function removeCitation(
  id: string,
  tenantId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!id) return { ok: false, reason: "id is required" };
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("seo_citations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tid);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// --- AI NAP audit ----------------------------------------------------------

export interface CitationFinding {
  source: string;
  nameFound: string | null;
  addressFound: string | null;
  phoneFound: string | null;
  status: CitationStatus;
  issues: string | null;
}

const MAX_AUDIT_CHARS = 24_000;

const AUDIT_SYSTEM = `You are a local-SEO specialist auditing a law firm's citations (NAP — Name, Address, Phone) for consistency. For local search ranking, the firm's NAP must be IDENTICAL across every directory and listing. You are given the firm's CANONICAL NAP and a block of RAW LISTING TEXT the user pasted from one or more directory/citation sites (Google Business Profile, Yelp, Bing, legal directories, etc.).

Your job: for each distinct source you can identify in the pasted text, extract the Name / Address / Phone as they appear there and compare to canonical.

Comparison rules:
- Phone: compare digits only; formatting differences ((212) 460-0047 vs 212-460-0047) are NOT inconsistencies.
- Address: "Suite" vs "Ste", "Avenue" vs "Ave", "New York, NY" vs "New York, New York" are minor and acceptable IF they refer to the same place — note them but treat as consistent unless the actual street, suite, city, or ZIP differs.
- Name: trailing entity suffixes (PLLC, LLP) matter; a different firm name is a real inconsistency.
- status "consistent" = NAP matches canonical (allowing the formatting tolerances above).
- status "inconsistent" = at least one of name/address/phone genuinely differs.
- status "missing" = the source appears but has no usable NAP, or a field is blank.
- If you cannot identify a clear source name, use a short descriptive label.

Return ONLY a JSON object, no markdown fences:
{
  "findings": [
    {
      "source": "Yelp",
      "nameFound": "...",
      "addressFound": "...",
      "phoneFound": "...",
      "status": "consistent" | "inconsistent" | "missing",
      "issues": "what differs from canonical, or null if consistent"
    }
  ]
}

Be precise. Do not invent sources or NAP values that aren't in the pasted text.`;

export async function auditCitations(
  rawText: string,
  tenantId?: string,
): Promise<{ canonical: CanonicalNap; findings: CitationFinding[] }> {
  const text = (rawText || "").trim();
  if (!text) throw new Error("Paste some listing text to audit");
  const tid = tenantId ?? (await resolveTenantId());
  const canonical = await getCanonicalNap(tid);

  const truncated = text.length > MAX_AUDIT_CHARS;
  const body = truncated ? text.slice(0, MAX_AUDIT_CHARS) : text;

  const userPrompt = `Audit these citations for NAP consistency.

CANONICAL NAP (the source of truth):
- Name: ${canonical.name}
- Address: ${canonical.address}
- Phone: ${canonical.phone}

RAW LISTING TEXT (one or more sources):
"""
${body}
"""

Return ONLY the JSON object.`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4000,
    system: AUDIT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  const out = response.content[0]?.type === "text" ? response.content[0].text : "";
  const parsed = extractJSON<{ findings?: CitationFinding[] }>(out);
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return { canonical, findings };
}
