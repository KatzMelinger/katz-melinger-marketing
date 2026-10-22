/**
 * Learn from results after publishing (Oct 20 spec, Task A10).
 *
 * At 30 and 90 days after a page goes live, record for its primary keyword:
 * Search Console position, impressions, clicks and CTR (last 28 days, that
 * page only); whether the AI answers the AEO tracker collected for related
 * prompts cite katzmelinger.com; and the CallRail calls and form leads whose
 * landing page was this page. Stored in metadata.results.
 *
 * At 90 days a page is Underperforming when it is outside the top 20 with
 * fewer than 10 clicks, or no related AI answer cites the firm. It goes to
 * the Refresh Queue (a page_refresh decision) with the reason, the data and
 * the competitor gaps from the Task A8 checks; approving it makes the refresh
 * draft, which Improve to Ready (Task A9) runs on like any new draft.
 *
 * Each month, monthlyCheckReport compares which Task A8 checks passed on
 * pages that performed and on pages that did not. It proposes; Diana decides
 * (thresholds are not changed here).
 */
import { getSupabaseAdmin } from "./supabase-server";
import { gscQueries, type GscRow } from "./gsc-queries";
import { normalizeUrlForMatch } from "./wordpress";
import { keywordIn, qualityForDraft, type QualityCheck } from "./quality-checks";
import { readQualitySerp } from "./quality-checks-serp";
import { readContent } from "./draft-frame";

export type ResultSnapshot = {
  day: 30 | 90;
  measured_at: string;
  keyword: string | null;
  position: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
  /** Page totals across every query, for context. */
  page_clicks: number;
  page_impressions: number;
  ai_prompts: number;
  ai_cited: number;
  calls: number;
  forms: number;
  gsc_error?: string;
};

export type ResultsRecord = {
  d30?: ResultSnapshot;
  d90?: ResultSnapshot;
  underperforming?: { reasons: string[]; at: string; suggestion_id: string | null } | null;
};

export function readResults(meta: Record<string, unknown> | null | undefined): ResultsRecord {
  const r = meta?.results;
  return r && typeof r === "object" ? (r as ResultsRecord) : {};
}

export function publishedAt(meta: Record<string, unknown>): string | null {
  const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? {};
  const v = wp.published_at ?? meta.published_at;
  return typeof v === "string" ? v : null;
}

export function liveUrl(meta: Record<string, unknown>): string | null {
  const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? {};
  for (const v of [wp.url, meta.publishedUrl, meta.update_target_url]) if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  return null;
}

export function primaryKeyword(meta: Record<string, unknown>): string | null {
  const kb = (meta.km_brief as Record<string, unknown> | undefined) ?? {};
  const sb = (meta.seo_brief as Record<string, unknown> | undefined) ?? {};
  const sel = (meta.keyword_selection as { chosen?: { keyword?: unknown } } | undefined)?.chosen?.keyword;
  for (const k of [meta.primaryKeyword, meta.primary_keyword, kb.primaryKeyword, sb.primaryKeyword, sel]) {
    if (typeof k === "string" && k.trim()) return k.trim();
  }
  return null;
}

/** The snapshot due now, if any: 30 days (until 90) and 90 days. */
export function dueSnapshot(published: string, results: ResultsRecord, nowMs: number): 30 | 90 | null {
  const days = (nowMs - new Date(published).getTime()) / 86_400_000;
  if (days >= 90 && !results.d90) return 90;
  if (days >= 30 && days < 90 && !results.d30) return 30;
  return null;
}

/** Search Console numbers for one page and its keyword. */
export function gscForPage(rows: GscRow[], url: string, keyword: string | null) {
  const key = normalizeUrlForMatch(url);
  const page = rows.filter((r) => r.page && normalizeUrlForMatch(r.page) === key);
  const exact = keyword ? page.find((r) => r.query.trim().toLowerCase() === keyword.toLowerCase()) : undefined;
  const near = keyword
    ? page.filter((r) => keywordIn(keyword, r.query)).sort((a, b) => b.impressions - a.impressions)[0]
    : undefined;
  const row = exact ?? near ?? null;
  return {
    position: row ? Math.round(row.position * 10) / 10 : null,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    ctr: row ? Math.round(row.ctr * 1000) / 10 : 0,
    page_clicks: page.reduce((n, r) => n + r.clicks, 0),
    page_impressions: page.reduce((n, r) => n + r.impressions, 0),
  };
}

/** Reasons a page is Underperforming at 90 days (empty: it is not). */
export function underperformingReasons(s: ResultSnapshot): string[] {
  const out: string[] = [];
  if ((s.position == null || s.position > 20) && s.clicks < 10) {
    out.push(
      s.position == null
        ? `Not ranking for "${s.keyword ?? "its keyword"}" after 90 days, ${s.clicks} clicks.`
        : `Position ${s.position} for "${s.keyword}" (outside the top 20) with ${s.clicks} clicks.`,
    );
  }
  if (s.ai_prompts > 0 && s.ai_cited === 0) out.push(`Not cited in any of ${s.ai_prompts} related AI answers.`);
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "what", "how", "can", "you", "your", "are", "does", "new", "york", "nyc", "lawyer", "attorney", "law", "best"]);
function significant(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** AEO prompts related to a keyword: share at least two significant words (or the only one). */
export function relatedPrompt(keyword: string, prompt: string): boolean {
  const k = [...new Set(significant(keyword))];
  if (!k.length) return false;
  const p = new Set(significant(prompt).flatMap((w) => [w, w.replace(/s$/, "")]));
  const hits = k.filter((w) => p.has(w) || p.has(w.replace(/s$/, ""))).length;
  return hits >= Math.min(2, k.length);
}

async function measure(tenantId: string, day: 30 | 90, url: string, keyword: string | null, published: string, gsc: Awaited<ReturnType<typeof gscQueries>>, siteHost: string): Promise<ResultSnapshot> {
  const sb = getSupabaseAdmin();
  const g = gsc.ok ? gscForPage(gsc.rows, url, keyword) : { position: null, impressions: 0, clicks: 0, ctr: 0, page_clicks: 0, page_impressions: 0 };

  // AI answers from the last 45 days for prompts related to the keyword.
  let aiPrompts = 0;
  let aiCited = 0;
  if (keyword) {
    const { data: prompts } = await sb.from("aeo_prompts").select("id, prompt").eq("tenant_id", tenantId).limit(2000);
    const ids = (prompts ?? []).filter((p) => relatedPrompt(keyword, String(p.prompt ?? ""))).map((p) => p.id as string);
    if (ids.length) {
      const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
      const { data: answers } = await sb
        .from("aeo_responses")
        .select("prompt_id, citations")
        .eq("tenant_id", tenantId)
        .in("prompt_id", ids.slice(0, 200))
        .gte("created_at", since)
        .limit(2000);
      const byPrompt = new Map<string, boolean>();
      for (const a of answers ?? []) {
        const cites = Array.isArray(a.citations)
          ? (a.citations as { url?: string; domain?: string }[]).some((c) => `${c.domain ?? ""} ${c.url ?? ""}`.toLowerCase().includes(siteHost))
          : false;
        byPrompt.set(a.prompt_id as string, (byPrompt.get(a.prompt_id as string) ?? false) || cites);
      }
      aiPrompts = byPrompt.size;
      aiCited = [...byPrompt.values()].filter(Boolean).length;
    }
  }

  // Leads whose landing page was this page, since it went live.
  const path = new URL(url).pathname.replace(/\/+$/, "");
  let calls = 0;
  let forms = 0;
  if (path && path !== "/") {
    const like = `%${siteHost}${path}%`;
    const c = await sb.from("calls").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("start_time", published).ilike("raw->>landing_page_url", like);
    calls = c.count ?? 0;
    const f = await sb.from("forms").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("submitted_at", published).ilike("raw->>landing_page_url", like);
    forms = f.count ?? 0;
  }

  return {
    day,
    measured_at: new Date().toISOString(),
    keyword,
    ...g,
    ai_prompts: aiPrompts,
    ai_cited: aiCited,
    calls,
    forms,
    ...(gsc.ok ? {} : { gsc_error: gsc.error }),
  };
}

/** Competitor gaps for the refresh: the Task A8 checks the page fails. */
function gapsFor(meta: Record<string, unknown>, d: { title: string | null; topic: string | null; practice_area: string | null }): string[] {
  const content = readContent(meta);
  const checks: QualityCheck[] = [];
  if (content) checks.push(...qualityForDraft({ metadata: meta, title: d.title, topic: d.topic, practice_area: d.practice_area } as never, content));
  const serp = readQualitySerp(meta);
  if (serp) checks.push(...serp.checks);
  const gaps = checks.filter((c) => !c.pass && c.gap).map((c) => `${c.label}: ${c.gap}`);
  if (serp?.uncoveredQuestions.length) gaps.push(`Questions competitors answer that this page does not: ${serp.uncoveredQuestions.slice(0, 5).join("; ")}`);
  return gaps;
}

async function queueRefresh(tenantId: string, draft: { id: string; title: string | null; practice_area: string | null }, url: string, s: ResultSnapshot, reasons: string[], gaps: string[]): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("brief_suggestions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source", "results_a10")
    .eq("source_ref", draft.id)
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;
  const reasoning = [
    `Underperforming at 90 days. ${reasons.join(" ")}`,
    `Data: position ${s.position ?? "none"}, ${s.impressions} impressions, ${s.clicks} clicks, CTR ${s.ctr}%, ${s.ai_cited} of ${s.ai_prompts} related AI answers cite the firm, ${s.calls} calls and ${s.forms} form leads from the page.`,
    gaps.length ? `Gaps to close: ${gaps.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { data, error } = await sb
    .from("brief_suggestions")
    .insert({
      tenant_id: tenantId,
      cluster_name: draft.title ?? s.keyword ?? url,
      primary_keyword: s.keyword ?? draft.title ?? url,
      secondary_keywords: [],
      content_type: "blog",
      practice_area: draft.practice_area ?? "employment",
      pillar_id: null,
      search_intent: null,
      recommended_action: "page_refresh",
      priority: "high",
      reasoning,
      decision_source: "results",
      suggested_brief: {},
      metrics: { currentRank: s.position },
      cannibalization_risk: "none",
      existing_url: url,
      source: "results_a10",
      source_ref: draft.id,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[page-results] refresh queue insert failed:", error.message);
    return null;
  }
  return data.id as string;
}

/** Measure every published page whose 30 or 90 day snapshot is due. */
export async function measureDuePages(tenantId: string, nowMs = Date.now()): Promise<{ measured: number; underperforming: number; gscError: string | null }> {
  const sb = getSupabaseAdmin();
  const { data: drafts, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, practice_area, metadata")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .limit(2000);
  if (error) throw new Error(error.message);
  const due = (drafts ?? [])
    .map((d) => {
      const meta = (d.metadata as Record<string, unknown> | null) ?? {};
      const pub = publishedAt(meta);
      const url = liveUrl(meta);
      const day = pub && url ? dueSnapshot(pub, readResults(meta), nowMs) : null;
      return { d, meta, pub, url, day };
    })
    .filter((x) => x.day && x.url && x.pub);
  if (!due.length) return { measured: 0, underperforming: 0, gscError: null };

  const gsc = await gscQueries(tenantId, { days: 28, withPage: true });
  const siteHost = (() => {
    try {
      return new URL(due[0].url!).host.replace(/^www\./, "").toLowerCase();
    } catch {
      return "katzmelinger.com";
    }
  })();
  let underperforming = 0;
  for (const x of due) {
    const snap = await measure(tenantId, x.day!, x.url!, primaryKeyword(x.meta), x.pub!, gsc, siteHost);
    const results: ResultsRecord = { ...readResults(x.meta), [x.day === 30 ? "d30" : "d90"]: snap };
    if (x.day === 90) {
      const reasons = underperformingReasons(snap);
      if (reasons.length) {
        underperforming++;
        const id = await queueRefresh(tenantId, { id: x.d.id as string, title: x.d.title as string | null, practice_area: x.d.practice_area as string | null }, x.url!, snap, reasons, gapsFor(x.meta, { title: x.d.title as string | null, topic: x.d.topic as string | null, practice_area: x.d.practice_area as string | null }));
        results.underperforming = { reasons, at: snap.measured_at, suggestion_id: id };
      } else {
        results.underperforming = null;
      }
    }
    // Re-read so a concurrent edit is not overwritten.
    const { data: now } = await sb.from("content_drafts").select("metadata").eq("tenant_id", tenantId).eq("id", x.d.id).maybeSingle();
    const latest = (now?.metadata as Record<string, unknown> | null) ?? x.meta;
    await sb.from("content_drafts").update({ metadata: { ...latest, results } }).eq("tenant_id", tenantId).eq("id", x.d.id);
  }
  return { measured: due.length, underperforming, gscError: gsc.ok ? null : gsc.error };
}

export type CheckRow = { key: string; label: string; performing: { pass: number; total: number }; underperforming: { pass: number; total: number }; predicts: "yes" | "no" | "not enough data" };

/**
 * Which Task A8 checks predict results: pass rate on pages that performed vs
 * pages that did not (pages with a 90 day result, else a 30 day one).
 */
export function checkReport(pages: { performing: boolean; checks: QualityCheck[] }[]): CheckRow[] {
  const rows = new Map<string, CheckRow>();
  for (const p of pages) {
    for (const c of p.checks) {
      const r = rows.get(c.key) ?? { key: c.key, label: c.label, performing: { pass: 0, total: 0 }, underperforming: { pass: 0, total: 0 }, predicts: "not enough data" as const };
      const side = p.performing ? r.performing : r.underperforming;
      side.total++;
      if (c.pass) side.pass++;
      rows.set(c.key, r);
    }
  }
  for (const r of rows.values()) {
    if (r.performing.total < 3 || r.underperforming.total < 3) continue;
    const gap = r.performing.pass / r.performing.total - r.underperforming.pass / r.underperforming.total;
    r.predicts = gap >= 0.2 ? "yes" : "no";
  }
  return [...rows.values()];
}

export type ResultsPage = {
  id: string;
  title: string | null;
  url: string;
  published_at: string;
  keyword: string | null;
  results: ResultsRecord;
};

export async function resultsOverview(tenantId: string): Promise<{ pages: ResultsPage[]; report: CheckRow[] }> {
  const { data } = await getSupabaseAdmin()
    .from("content_drafts")
    .select("id, title, topic, practice_area, metadata")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .limit(2000);
  const pages: ResultsPage[] = [];
  const forReport: { performing: boolean; checks: QualityCheck[] }[] = [];
  for (const d of data ?? []) {
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const url = liveUrl(meta);
    const pub = publishedAt(meta);
    if (!url || !pub) continue;
    const results = readResults(meta);
    pages.push({ id: d.id as string, title: d.title as string | null, url, published_at: pub, keyword: primaryKeyword(meta), results });
    const snap = results.d90 ?? results.d30;
    if (!snap) continue;
    const content = readContent(meta);
    const checks: QualityCheck[] = content ? qualityForDraft({ metadata: meta, title: d.title, topic: d.topic, practice_area: d.practice_area } as never, content) : [];
    const serp = readQualitySerp(meta);
    if (serp) checks.push(...serp.checks);
    forReport.push({ performing: underperformingReasons(snap).length === 0, checks });
  }
  pages.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return { pages, report: checkReport(forReport) };
}

export function reportText(report: CheckRow[], pages: number): string {
  const pct = (s: { pass: number; total: number }) => (s.total ? `${Math.round((s.pass / s.total) * 100)}% of ${s.total}` : "no pages");
  const lines = report.map(
    (r) => `${r.label}: passed on ${pct(r.performing)} performing pages, ${pct(r.underperforming)} underperforming. Predicts results: ${r.predicts}.`,
  );
  const proposals = report
    .filter((r) => r.predicts === "no")
    .map((r) => `Consider relaxing or removing "${r.label}": it passes about as often on pages that do not perform.`);
  return [
    `Monthly check report (Oct 20 spec, Task A10): ${pages} published page${pages === 1 ? "" : "s"} with results.`,
    "",
    ...lines,
    "",
    proposals.length ? "Proposed for your decision (nothing changes until you approve):" : "No threshold changes proposed this month.",
    ...proposals,
  ].join("\n");
}
