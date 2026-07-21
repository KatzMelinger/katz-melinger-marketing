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
import { assertPublicUrl } from "@/lib/url-safety";

export interface CanonicalNap {
  name: string;
  address: string;
  phone: string;
  /** Firm website — shown in the guided-update panel; not part of the NAP
   *  comparison yet (that's a separate canonical-profile expansion). */
  website: string;
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

export interface CitationSnapshot {
  captured_on: string;
  total: number;
  consistent: number;
  inconsistent: number;
  missing: number;
  unverified: number;
  consistency_pct: number;
}

/**
 * Record today's consistency snapshot (one row per tenant per day, upserted) so
 * the page can chart consistency/coverage over time. Best-effort: if the
 * snapshots table hasn't been migrated yet, this quietly no-ops.
 */
export async function saveCitationSnapshot(tenantId?: string): Promise<void> {
  try {
    const tid = tenantId ?? (await resolveTenantId());
    const rows = await listCitations(tid);
    const total = rows.length;
    const consistent = rows.filter((r) => r.status === "consistent").length;
    const inconsistent = rows.filter((r) => r.status === "inconsistent").length;
    const missing = rows.filter((r) => r.status === "missing").length;
    const unverified = rows.filter((r) => r.status === "unverified").length;
    // Consistency % measured against the listings we could actually verify
    // (consistent + inconsistent); unverified/missing don't count either way.
    const verifiable = consistent + inconsistent;
    const consistencyPct = verifiable ? Math.round((consistent / verifiable) * 100) : 0;

    const supabase = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("seo_citation_snapshots").upsert(
      {
        tenant_id: tid,
        captured_on: today,
        total,
        consistent,
        inconsistent,
        missing,
        unverified,
        consistency_pct: consistencyPct,
      },
      { onConflict: "tenant_id,captured_on" },
    );
  } catch {
    /* best-effort — never fail an audit because history couldn't be written */
  }
}

/** Recent daily snapshots (oldest→newest), for the trend panel. Fail-soft. */
export async function listCitationSnapshots(
  limit = 30,
  tenantId?: string,
): Promise<CitationSnapshot[]> {
  try {
    const supabase = getSupabaseServer();
    if (!supabase) return [];
    const tid = tenantId ?? (await resolveTenantId());
    const { data, error } = await supabase
      .from("seo_citation_snapshots")
      .select("captured_on, total, consistent, inconsistent, missing, unverified, consistency_pct")
      .eq("tenant_id", tid)
      .order("captured_on", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as CitationSnapshot[]).slice().reverse();
  } catch {
    return [];
  }
}

export async function getCanonicalNap(tenantId?: string): Promise<CanonicalNap> {
  const config = await getTenantConfig(tenantId);
  return {
    name: config.firmName,
    address: config.firmAddress,
    phone: config.firmPhone,
    website: config.firmWebsite,
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

/**
 * Bulk-load tracked listings from a pasted list / CSV (Domain + Citation Link).
 * Each entry seeds a row with its listing_url so the "Audit from saved links"
 * run picks it up automatically. Unlike addCitation's full upsert, this never
 * clobbers an already-audited row: a source that already exists keeps its NAP
 * and status; we only backfill a missing listing_url. New sources are inserted
 * as `unverified` awaiting the next audit.
 *
 * NOTE: `bySource` is built once and not updated between inserts, so `entries`
 * must be de-duped by (case-insensitive) source before calling — the import
 * route's parseImport() does this. Duplicate sources in one batch would
 * otherwise attempt a second insert on the same (tenant, source) unique key.
 */
export async function importCitations(
  entries: { source: string; listing_url: string }[],
  tenantId?: string,
): Promise<{ added: number; updated: number; skipped: number }> {
  const tid = tenantId ?? (await resolveTenantId());
  const supabase = getSupabaseAdmin();
  const { data: existingRows } = await supabase
    .from("seo_citations")
    .select("source, listing_url")
    .eq("tenant_id", tid);
  const bySource = new Map(
    (existingRows ?? []).map((r) => [
      String((r as { source: string }).source).toLowerCase(),
      r as { source: string; listing_url: string | null },
    ]),
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const e of entries) {
    const source = (e.source || "").trim();
    const url = (e.listing_url || "").trim();
    if (!source || !url) {
      skipped++;
      continue;
    }
    const found = bySource.get(source.toLowerCase());
    if (!found) {
      const { error } = await supabase.from("seo_citations").insert({
        tenant_id: tid,
        source,
        listing_url: url,
        status: "unverified",
        source_type: "scan",
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) skipped++;
      else added++;
    } else if (!(found.listing_url ?? "").trim()) {
      // Existing row without a URL → backfill it, preserving everything else.
      const { error } = await supabase
        .from("seo_citations")
        .update({ listing_url: url, updated_at: new Date().toISOString() })
        .eq("tenant_id", tid)
        .eq("source", found.source);
      if (error) skipped++;
      else updated++;
    } else {
      skipped++; // already tracked with a URL — leave it untouched
    }
  }
  return { added, updated, skipped };
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

// --- Audit by link (fetch each saved listing_url) --------------------------

export interface LinkAuditResult {
  source: string;
  listing_url: string;
  status: CitationStatus | string;
  issues: string | null;
  fetched: boolean; // false = couldn't read the page (likely bot-blocked)
}

const LINK_AUDIT_SYSTEM = `You verify whether a law firm's Name/Address/Phone (NAP) on a single directory/listing page matches the firm's canonical NAP. You are given the canonical NAP, the SOURCE name, and the readable text of that listing page. Extract the firm's Name/Address/Phone as they appear on the page and compare to canonical.

Comparison rules:
- Phone: compare digits only; formatting differences are NOT inconsistencies.
- Address: "Suite"/"Ste", "Avenue"/"Ave", "NY"/"New York" are minor — treat as consistent unless the actual street, suite, city, or ZIP differs.
- Name: entity suffixes (PLLC, LLP) matter; a different firm name is a real inconsistency.
- status "consistent" = matches (allowing the tolerances above). "inconsistent" = a genuine difference. "missing" = the firm/NAP isn't on the page (a block page, login wall, or the listing simply isn't there).

Return ONLY a JSON object, no markdown fences:
{"nameFound": <string|null>, "addressFound": <string|null>, "phoneFound": <string|null>, "status": "consistent"|"inconsistent"|"missing", "issues": <string|null>}`;

async function fetchListingText(url: string): Promise<string> {
  // SSRF guard: listing_url is user-supplied; never fetch internal addresses.
  await assertPublicUrl(url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; KMDashboard/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function auditOneListing(
  source: string,
  text: string,
  canonical: CanonicalNap,
): Promise<{
  nameFound: string | null;
  addressFound: string | null;
  phoneFound: string | null;
  status: CitationStatus;
  issues: string | null;
}> {
  const truncated = text.length > MAX_AUDIT_CHARS ? text.slice(0, MAX_AUDIT_CHARS) : text;
  const user = `CANONICAL NAP:
- Name: ${canonical.name}
- Address: ${canonical.address}
- Phone: ${canonical.phone}

SOURCE: ${source}

LISTING PAGE TEXT:
"""
${truncated}
"""

Return ONLY the JSON object.`;
  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 1000,
    system: LINK_AUDIT_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const out = response.content[0]?.type === "text" ? response.content[0].text : "";
  const parsed = extractJSON<{
    nameFound?: string | null;
    addressFound?: string | null;
    phoneFound?: string | null;
    status?: string;
    issues?: string | null;
  }>(out);
  const status = (["consistent", "inconsistent", "missing"].includes(parsed.status ?? "")
    ? parsed.status
    : "unverified") as CitationStatus;
  return {
    nameFound: parsed.nameFound ?? null,
    addressFound: parsed.addressFound ?? null,
    phoneFound: parsed.phoneFound ?? null,
    status,
    issues: parsed.issues ?? null,
  };
}

/**
 * Audit every saved citation that has a listing_url by FETCHING the link and
 * AI-checking its NAP — no pasting. Updates each row in place. Directory sites
 * that block bots (Yelp / Avvo / BBB) come back "unverified" with a note to
 * paste that one instead.
 */
export async function auditCitationsByLinks(
  tenantId?: string,
): Promise<{ canonical: CanonicalNap; results: LinkAuditResult[] }> {
  const tid = tenantId ?? (await resolveTenantId());
  const canonical = await getCanonicalNap(tid);
  const citations = (await listCitations(tid)).filter((c) => (c.listing_url ?? "").trim());

  const results: LinkAuditResult[] = [];
  for (const c of citations) {
    const url = (c.listing_url as string).trim();
    let text = "";
    try {
      text = await fetchListingText(url);
    } catch (e) {
      results.push({
        source: c.source,
        listing_url: url,
        status: "unverified",
        issues: `Could not read the listing automatically (${
          e instanceof Error ? e.message : "blocked"
        }). Paste the listing text to audit it.`,
        fetched: false,
      });
      continue;
    }
    if (text.length < 50) {
      results.push({
        source: c.source,
        listing_url: url,
        status: "unverified",
        issues:
          "The page returned little readable text (likely bot-blocked). Paste the listing text instead.",
        fetched: false,
      });
      continue;
    }
    try {
      const f = await auditOneListing(c.source, text, canonical);
      await updateCitation(
        c.id,
        {
          nap_name: f.nameFound,
          nap_address: f.addressFound,
          nap_phone: f.phoneFound,
          status: f.status,
          issues: f.issues,
        },
        tid,
      );
      results.push({
        source: c.source,
        listing_url: url,
        status: f.status,
        issues: f.issues,
        fetched: true,
      });
    } catch (e) {
      results.push({
        source: c.source,
        listing_url: url,
        status: "unverified",
        issues: e instanceof Error ? e.message : "Audit failed.",
        fetched: false,
      });
    }
  }
  return { canonical, results };
}
