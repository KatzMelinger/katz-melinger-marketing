/**
 * The IO half of keyword selection (Oct 6 spec, Task 15): DataForSEO
 * candidates, and everything that already targets a keyword. See
 * lib/keyword-selection.ts for the rules.
 */
import { getGoogleAccessToken } from "./google-access-token";
import { getKeywordMetrics, getKeywordSuggestions, getLocalSearchVolume, getRelatedKeywords } from "./dataforseo";
import { primaryKeyword } from "./draft-metadata";
import { keywordProblem, seedFromTitle } from "./keyword-guard";
import { chooseKeyword, type ExistingTarget, type KeywordCandidate, type KeywordDecision } from "./keyword-selection";
import { getSupabaseAdmin } from "./supabase-server";
import { getTenantConfig } from "./tenant-config";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** How many candidates get a New York volume (one Google Ads call). */
const NY_TOP = 15;

/**
 * Real candidates for a seed: related keywords, suggestions and local variants.
 * Spanish content (Oct 20 spec, Task A13) uses DataForSEO's Spanish data and
 * adds the Spanish queries the site already gets in Search Console.
 */
export async function gatherCandidates(
  seed: string,
  incoming?: string | null,
  language: "en" | "es" = "en",
  spanishQueries: string[] = [],
): Promise<KeywordCandidate[]> {
  const s = seed.trim().toLowerCase();
  if (!s) return [];
  const [related, suggestions] = await Promise.all([
    getRelatedKeywords(s, 40, language).catch(() => []),
    getKeywordSuggestions(s, 40, language).catch(() => []),
  ]);
  const phrases = new Set<string>(
    language === "es" ? [s, `${s} nueva york`, `${s} en nueva york`, `abogado ${s}`] : [s, `${s} ny`, `${s} in ny`, `${s} new york`],
  );
  if (incoming && !keywordProblem(incoming)) phrases.add(incoming.trim().toLowerCase());
  for (const r of [...related, ...suggestions]) if (r.keyword) phrases.add(r.keyword.toLowerCase().trim());
  for (const q of spanishQueries) phrases.add(q.toLowerCase().trim());
  const usable = [...phrases].filter((p) => !keywordProblem(p)).slice(0, 120);
  const metrics = await getKeywordMetrics(usable, language);
  const out: KeywordCandidate[] = [...metrics.values()].map((m) => ({ ...m }));
  // Keep the phrases DataForSEO knows nothing about too, so the decision can
  // say "no search volume" rather than silently dropping them.
  for (const p of usable) {
    if (!metrics.has(p)) out.push({ keyword: p, volume: null, difficulty: null, monthly: [], source: "dataforseo", fetchedAt: new Date().toISOString() });
  }
  const top = out.filter((c) => c.volume).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, NY_TOP);
  const ny = await getLocalSearchVolume(top.map((c) => c.keyword)).catch(() => new Map());
  for (const c of out) {
    const v = ny.get(c.keyword);
    if (v) c.volumeNy = v.volume;
  }
  return out;
}

/** Search Console queries a site URL ranks top 20 for, last 90 days. Cached an hour. */
let gscCache: { at: number; tenantId: string; rows: { query: string; page: string; position: number }[] } | null = null;
async function rankingQueries(tenantId: string): Promise<{ query: string; page: string; position: number }[]> {
  if (gscCache && gscCache.tenantId === tenantId && Date.now() - gscCache.at < 3600_000) return gscCache.rows;
  try {
    const { gscSiteUrl } = await getTenantConfig(tenantId);
    if (!gscSiteUrl) return [];
    const auth = await getGoogleAccessToken([GSC_SCOPE], tenantId);
    if ("error" in auth) return [];
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 864e5);
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          dimensions: ["query", "page"],
          rowLimit: 5000,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { rows?: { keys?: string[]; position?: number }[] };
    const rows = (json.rows ?? [])
      .filter((r) => r.keys?.length === 2 && typeof r.position === "number" && r.position <= 20)
      .map((r) => ({ query: r.keys![0], page: r.keys![1], position: r.position! }));
    gscCache = { at: Date.now(), tenantId, rows };
    return rows;
  } catch {
    return [];
  }
}

const SPANISH_WORDS = /\b(?:abogad[oa]s?|despido|injustificado|salarios?|horas|extras?|trabajo|trabajador(?:es)?|empleador|empleados?|acoso|discriminaci[oó]n|demanda|derechos|sueldo|pago|cobro|deuda|nueva|de|del|en|por|para|que|mi|me)\b/gi;

/** A query written in Spanish: two or more Spanish words, or one Spanish letter. */
export function isSpanishQuery(q: string): boolean {
  return /[ñáéíóú¿¡]/i.test(q) || (q.match(SPANISH_WORDS) ?? []).length >= 2;
}

/**
 * Spanish Search Console queries that share a word with the seed (October 2
 * example: "abogado de despido injustificado", 167 impressions, position 5.5).
 */
export function spanishQueriesFor(seed: string, rows: { query: string }[]): string[] {
  const words = seed.toLowerCase().match(/[a-záéíóúñ]{4,}/g) ?? [];
  const out = new Set<string>();
  for (const r of rows) {
    const q = r.query.toLowerCase();
    if (isSpanishQuery(q) && words.some((w) => q.includes(w))) out.add(q);
  }
  return [...out].slice(0, 30);
}

/** Everything that already targets a keyword, from the four sources. */
export async function loadExistingTargets(tenantId: string, excludeDraftId?: string | null): Promise<ExistingTarget[]> {
  const sb = getSupabaseAdmin();
  const [pages, drafts, tracked, gsc] = await Promise.all([
    sb.from("site_pages").select("url, title, h1").eq("tenant_id", tenantId).limit(3000),
    sb.from("content_drafts").select("id, title, topic, status, metadata, seo_brief").eq("tenant_id", tenantId).limit(3000),
    sb.from("seo_keywords").select("keyword").eq("tenant_id", tenantId).limit(3000),
    rankingQueries(tenantId),
  ]);
  const out: ExistingTarget[] = [];
  for (const p of pages.data ?? []) {
    const url = String(p.url ?? "");
    const slug = url.replace(/^https?:\/\/[^/]+/, "").replace(/[/_-]+/g, " ");
    out.push({ kind: "page", text: `${p.title ?? ""} ${p.h1 ?? ""} ${slug}`, label: url, url });
  }
  for (const d of drafts.data ?? []) {
    if (d.id === excludeDraftId) continue;
    const kw = primaryKeyword(d as Parameters<typeof primaryKeyword>[0]);
    if (!kw || keywordProblem(kw)) continue;
    out.push({ kind: "draft", text: kw, label: `draft ${String(d.id).slice(0, 8)} ("${(d.title as string | null) ?? kw}")`, draftId: d.id as string });
  }
  for (const t of tracked.data ?? []) if (t.keyword) out.push({ kind: "tracker", text: String(t.keyword), label: String(t.keyword) });
  for (const g of gsc) out.push({ kind: "gsc", text: g.query, label: g.page, url: g.page });
  return out;
}

/** The whole pipeline for one draft. */
export async function selectKeyword(args: {
  tenantId: string;
  title: string;
  incoming?: string | null;
  excludeDraftId?: string | null;
  /** Spanish drafts choose from Spanish data (Task A13). */
  language?: "en" | "es";
}): Promise<KeywordDecision> {
  const seed = args.incoming && !keywordProblem(args.incoming) ? args.incoming : seedFromTitle(args.title);
  const language = args.language ?? "en";
  const spanish = language === "es" ? spanishQueriesFor(seed, await rankingQueries(args.tenantId)) : [];
  const [candidates, existing] = await Promise.all([
    gatherCandidates(seed, args.incoming, language, spanish),
    loadExistingTargets(args.tenantId, args.excludeDraftId),
  ]);
  return chooseKeyword({ title: args.title, incoming: args.incoming, candidates, existing });
}
