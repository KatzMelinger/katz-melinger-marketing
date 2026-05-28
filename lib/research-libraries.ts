/**
 * CRUD helpers for the two research libraries:
 *   - legal_authority_sources  (Legal Authority Library)
 *   - people_ask_sources       (People Ask & Trends Library)
 *
 * Both are human-curated and feed the Research Packet generator. The People
 * Ask library also receives auto-captured rows from the live source
 * connectors (lib/research-sources.ts) when the research layer runs.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";

export type LegalSourceType =
  | "statute"
  | "regulation"
  | "agency"
  | "case_law"
  | "internal_page"
  | "other";

export type AuthorityLevel = "primary" | "secondary" | "tertiary";

export type ReviewStatus =
  | "unverified"
  | "verified"
  | "needs_review"
  | "archived";

export type LegalAuthoritySource = {
  id: string;
  name: string;
  url: string;
  source_type: LegalSourceType;
  practice_area: string | null;
  jurisdiction: string | null;
  authority_level: AuthorityLevel;
  topics: string[];
  notes: string | null;
  review_status: ReviewStatus;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PeopleAskSourceType =
  | "paa"
  | "autocomplete"
  | "semrush"
  | "search_console"
  | "reddit"
  | "youtube"
  | "avvo"
  | "justia"
  | "quora"
  | "competitor"
  | "manual";

export type PeopleAskSource = {
  id: string;
  content: string;
  source_type: PeopleAskSourceType;
  practice_area: string | null;
  topic_tags: string[];
  jurisdiction: string | null;
  use_case: string | null;
  trend_signal: string | null;
  source_url: string | null;
  metric: Record<string, unknown>;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Legal Authority Library
// ---------------------------------------------------------------------------

export async function listLegalSources(opts?: {
  practiceArea?: string;
  search?: string;
}): Promise<LegalAuthoritySource[]> {
  const sb = getSupabaseAdmin();
  let q = sb
    .from("legal_authority_sources")
    .select("*")
    .order("updated_at", { ascending: false });
  if (opts?.practiceArea) q = q.eq("practice_area", opts.practiceArea);
  if (opts?.search) q = q.ilike("name", `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LegalAuthoritySource[];
}

export async function upsertLegalSource(
  row: Partial<LegalAuthoritySource> & { name: string; url: string },
): Promise<LegalAuthoritySource> {
  const sb = getSupabaseAdmin();
  const payload: Record<string, unknown> = {
    name: row.name,
    url: row.url,
    source_type: row.source_type ?? "agency",
    practice_area: row.practice_area ?? null,
    jurisdiction: row.jurisdiction ?? null,
    authority_level: row.authority_level ?? "primary",
    topics: row.topics ?? [],
    notes: row.notes ?? null,
    review_status: row.review_status ?? "unverified",
    last_verified_at: row.last_verified_at ?? null,
  };
  if (row.id) payload.id = row.id;
  const { data, error } = await sb
    .from("legal_authority_sources")
    .upsert(payload)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "upsert failed");
  return data as LegalAuthoritySource;
}

export async function deleteLegalSource(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("legal_authority_sources")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// People Ask & Trends Library
// ---------------------------------------------------------------------------

export async function listPeopleAskSources(opts?: {
  practiceArea?: string;
  sourceType?: PeopleAskSourceType;
  search?: string;
}): Promise<PeopleAskSource[]> {
  const sb = getSupabaseAdmin();
  let q = sb
    .from("people_ask_sources")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (opts?.practiceArea) q = q.eq("practice_area", opts.practiceArea);
  if (opts?.sourceType) q = q.eq("source_type", opts.sourceType);
  if (opts?.search) q = q.ilike("content", `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PeopleAskSource[];
}

export async function upsertPeopleAskSource(
  row: Partial<PeopleAskSource> & { content: string },
): Promise<PeopleAskSource> {
  const sb = getSupabaseAdmin();
  const payload: Record<string, unknown> = {
    content: row.content,
    source_type: row.source_type ?? "manual",
    practice_area: row.practice_area ?? null,
    topic_tags: row.topic_tags ?? [],
    jurisdiction: row.jurisdiction ?? null,
    use_case: row.use_case ?? null,
    trend_signal: row.trend_signal ?? null,
    source_url: row.source_url ?? null,
    metric: row.metric ?? {},
    review_status: row.review_status ?? "unverified",
  };
  if (row.id) payload.id = row.id;
  const { data, error } = await sb
    .from("people_ask_sources")
    .upsert(payload)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "upsert failed");
  return data as PeopleAskSource;
}

/**
 * Bulk insert auto-captured people-ask rows (from live sources). Dedupes
 * against existing rows with the same content + source_type to avoid the
 * library filling with repeats on each research run.
 */
export async function insertPeopleAskBatch(
  rows: Array<Partial<PeopleAskSource> & { content: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const sb = getSupabaseAdmin();

  // Pull existing (content, source_type) pairs to dedupe.
  const { data: existing } = await sb
    .from("people_ask_sources")
    .select("content, source_type");
  const seen = new Set(
    (existing ?? []).map(
      (r) => `${(r.content as string).toLowerCase()}::${r.source_type}`,
    ),
  );

  const fresh = rows.filter((r) => {
    const key = `${r.content.toLowerCase()}::${r.source_type ?? "manual"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return 0;

  const payload = fresh.map((r) => ({
    content: r.content,
    source_type: r.source_type ?? "manual",
    practice_area: r.practice_area ?? null,
    topic_tags: r.topic_tags ?? [],
    jurisdiction: r.jurisdiction ?? null,
    use_case: r.use_case ?? null,
    trend_signal: r.trend_signal ?? null,
    source_url: r.source_url ?? null,
    metric: r.metric ?? {},
    review_status: "unverified" as const,
  }));
  const { error } = await sb.from("people_ask_sources").insert(payload);
  if (error) throw new Error(error.message);
  return payload.length;
}

export async function deletePeopleAskSource(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("people_ask_sources")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
