/**
 * Content gap views on the Opportunities page (Oct 6 spec, Task 18). Each is
 * built only from Search Console and DataForSEO data (plus the site's own page
 * list and the Radar, which holds DataForSEO numbers), and each item carries
 * its data source and an action: "Create brief" (opens the brief wizard, which
 * runs Task 15's keyword selection) or "Refresh page" (Redraft of that URL).
 */
import { getKeywordSuggestions, getPeopleAlsoAsk } from "./dataforseo";
import { gscQueries } from "./gsc-queries";
import { coverage, intentTokens } from "./keyword-guard";
import { classifyKeywordGeo } from "./keyword-geo";
import { loadExistingTargets } from "./keyword-selection-data";
import { getPillars } from "./pillars-store";
import { getSupabaseAdmin } from "./supabase-server";

export type GapView = "striking" | "missing" | "clusters" | "states" | "language" | "questions";

export type GapAction =
  | { kind: "brief"; keyword: string; secondary?: string[]; practiceArea?: string | null; pillarId?: string | null; language?: "en" | "es" }
  | { kind: "refresh"; url: string; title?: string | null; keywords: string[]; primaryKeyword?: string };

export type GapItem = {
  title: string;
  detail: string;
  /** Rows shown under the item (queries, terms). */
  rows?: { label: string; value: string }[];
  source: string;
  action: GapAction | null;
  flag?: string;
};

export type GapResult = { view: GapView; items: GapItem[]; summary: string[]; error?: string };

const day = (iso: string) => iso.slice(0, 10);

/* --------------------------------------------------------------------------
 * Striking distance: position 6-20, 30+ impressions, 28 days, by URL.
 * ------------------------------------------------------------------------ */
async function striking(tenantId: string): Promise<GapResult> {
  const g = await gscQueries(tenantId, { days: 28, withPage: true });
  if (!g.ok) return { view: "striking", items: [], summary: [], error: g.error };
  const byUrl = new Map<string, { impressions: number; clicks: number; rows: typeof g.rows }>();
  for (const r of g.rows) {
    if (!r.page || r.position < 6 || r.position > 20 || r.impressions < 30) continue;
    const e = byUrl.get(r.page) ?? { impressions: 0, clicks: 0, rows: [] };
    e.impressions += r.impressions;
    e.clicks += r.clicks;
    e.rows.push(r);
    byUrl.set(r.page, e);
  }
  const totals = g.rows.reduce(
    (a, r) => ({ imp: a.imp + r.impressions, clicks: a.clicks + r.clicks }),
    { imp: 0, clicks: 0 },
  );
  const items: GapItem[] = [...byUrl.entries()]
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 60)
    .map(([url, e]) => {
      const rows = e.rows.sort((a, b) => b.impressions - a.impressions);
      return {
        title: url.replace(/^https?:\/\/(www\.)?/, ""),
        detail: `${e.impressions.toLocaleString()} impressions, ${e.clicks} clicks across ${rows.length} queries at positions 6 to 20`,
        rows: rows.slice(0, 8).map((r) => ({ label: r.query, value: `pos ${r.position.toFixed(1)} · ${r.impressions} impr` })),
        source: `Search Console, 28 days to ${day(g.fetchedAt)}`,
        action: { kind: "refresh", url, keywords: rows.slice(0, 5).map((r) => r.query), primaryKeyword: rows[0]?.query },
      };
    });
  return {
    view: "striking",
    items,
    summary: [`Site, last 28 days: ${totals.imp.toLocaleString()} impressions, ${totals.clicks.toLocaleString()} clicks.`],
  };
}

/* --------------------------------------------------------------------------
 * Missing target on existing pages: tracked terms we do not rank for whose
 * topic belongs to a pillar page. Retarget that page instead of a new one.
 * ------------------------------------------------------------------------ */
async function missing(tenantId: string): Promise<GapResult> {
  const sb = getSupabaseAdmin();
  const [{ data }, pillars] = await Promise.all([
    sb
      .from("seo_opportunities")
      .select("keyword, search_volume, pillar_id, practice_area, metrics")
      .eq("tenant_id", tenantId)
      .eq("source", "missing")
      .eq("excluded", false)
      .order("search_volume", { ascending: false, nullsFirst: false })
      .limit(200),
    getPillars(tenantId),
  ]);
  const items: GapItem[] = [];
  for (const o of data ?? []) {
    const pillar = pillars.find((p) => p.id === o.pillar_id && p.url);
    if (!pillar) continue;
    const kw = String(o.keyword);
    items.push({
      title: kw,
      detail: `${o.search_volume != null ? `${Number(o.search_volume).toLocaleString()} searches/mo` : "no volume on record"} · belongs to the ${pillar.label} pillar page`,
      rows: [{ label: "Retarget", value: pillar.url }],
      source: "DataForSEO (Radar, missing target)",
      action: { kind: "refresh", url: pillar.url, keywords: [kw], primaryKeyword: kw, title: pillar.label },
    });
  }
  return { view: "missing", items, summary: ["Retarget the page's title, H1 and first paragraph instead of writing a new page."] };
}

/* --------------------------------------------------------------------------
 * Cluster gaps: three or more actionable terms in a pillar and no page.
 * ------------------------------------------------------------------------ */
async function clusters(tenantId: string): Promise<GapResult> {
  const sb = getSupabaseAdmin();
  const [{ data }, pillars, pages] = await Promise.all([
    sb
      .from("seo_opportunities")
      .select("keyword, search_volume, pillar_id, practice_area, existing_url, status")
      .eq("tenant_id", tenantId)
      .eq("excluded", false)
      .eq("status", "new")
      .is("existing_url", null)
      .limit(2000),
    getPillars(tenantId),
    sb.from("site_pages").select("url, title, h1").eq("tenant_id", tenantId).limit(3000),
  ]);
  const pageTok = (pages.data ?? []).map((p) => ({ url: String(p.url), tok: intentTokens(`${p.title ?? ""} ${p.h1 ?? ""}`) }));
  const groups = new Map<string, { kw: string; vol: number }[]>();
  for (const o of data ?? []) {
    const kw = String(o.keyword);
    const tok = intentTokens(kw);
    if (pageTok.some((p) => coverage(tok, p.tok) >= 0.99)) continue; // a page covers it
    const key = (o.pillar_id as string | null) ?? `area:${o.practice_area ?? "unknown"}`;
    const g = groups.get(key) ?? [];
    g.push({ kw, vol: Number(o.search_volume ?? 0) });
    groups.set(key, g);
  }
  const items: GapItem[] = [...groups.entries()]
    .filter(([, g]) => g.length >= 3)
    .map(([key, g]) => {
      g.sort((a, b) => b.vol - a.vol);
      const pillar = pillars.find((p) => p.id === key);
      const total = g.reduce((a, x) => a + x.vol, 0);
      return {
        title: pillar?.label ?? key.replace(/^area:/, ""),
        detail: `${g.length} terms, ${total.toLocaleString()} searches/mo, and no page covers them`,
        rows: g.slice(0, 10).map((x) => ({ label: x.kw, value: x.vol ? `${x.vol.toLocaleString()}/mo` : "—" })),
        source: "DataForSEO (Radar) and the site's page list",
        flag: "cluster gap",
        action: {
          kind: "brief" as const,
          keyword: g[0].kw,
          secondary: g.slice(1, 8).map((x) => x.kw),
          practiceArea: pillar?.practiceArea ?? null,
          pillarId: pillar?.id ?? null,
        },
      };
    })
    .sort((a, b) => (b.rows?.length ?? 0) - (a.rows?.length ?? 0));
  return { view: "clusters", items, summary: [] };
}

/* --------------------------------------------------------------------------
 * State coverage: New York vs New Jersey, queries and pages.
 * ------------------------------------------------------------------------ */
const NJ_SEEDS = [
  "new jersey minimum wage 2027",
  "can i work 6 hours without a lunch break in nj",
  "nj wage theft act six year lookback",
  "mandatory severance nj warn act",
  "cepa whistleblower new jersey",
];

async function states(tenantId: string): Promise<GapResult> {
  const sb = getSupabaseAdmin();
  const [g, pages, targets] = await Promise.all([
    gscQueries(tenantId, { days: 28, withPage: false }),
    sb.from("site_pages").select("url, title, h1").eq("tenant_id", tenantId).limit(3000),
    loadExistingTargets(tenantId),
  ]);
  const stateOf = (text: string) => {
    const s = classifyKeywordGeo(text).state;
    return s === "ny" || s === "nj" ? s : null;
  };
  const q = { ny: 0, nj: 0 };
  if (g.ok) for (const r of g.rows) if (r.position <= 20) { const s = stateOf(r.query); if (s) q[s]++; }
  const p = { ny: 0, nj: 0, both: 0 };
  for (const pg of pages.data ?? []) {
    const text = `${pg.title ?? ""} ${pg.h1 ?? ""} ${String(pg.url).replace(/[/_-]+/g, " ")}`;
    const ny = classifyKeywordGeo(text.replace(/new jersey|\bnj\b/gi, "")).state === "ny";
    const nj = classifyKeywordGeo(text.replace(/new york|\bny\b|\bnyc\b/gi, "")).state === "nj";
    if (ny && nj) p.both++;
    else if (ny) p.ny++;
    else if (nj) p.nj++;
  }
  const statePages = p.ny + p.nj + p.both;
  const njShare = statePages ? (p.nj + p.both) / statePages : 0;
  const summary = [
    `Ranking queries (top 20, 28 days): New York ${q.ny}, New Jersey ${q.nj}.`,
    `Pages naming a state: New York ${p.ny}, New Jersey ${p.nj}, both ${p.both}. New Jersey share ${Math.round(njShare * 100)}%.`,
  ];
  const items: GapItem[] = NJ_SEEDS.map((seed) => {
    const tok = intentTokens(seed);
    const hit = targets.find((t) => coverage(tok, intentTokens(t.text)) >= 0.99);
    const gscRow = g.ok ? g.rows.find((r) => r.query.toLowerCase() === seed) : undefined;
    return {
      title: seed,
      detail: hit ? `Covered: ${hit.label}` : "No page or draft targets this yet",
      rows: gscRow ? [{ label: "Search Console", value: `pos ${gscRow.position.toFixed(1)} · ${gscRow.impressions} impr` }] : [],
      source: gscRow ? "Search Console" : "Spec seed list, overlap checked",
      action: hit ? null : { kind: "brief", keyword: seed, practiceArea: "employment" },
    };
  });
  return {
    view: "states",
    items,
    summary: njShare < 0.25 ? [...summary, "New Jersey is under 25 percent of state pages."] : summary,
    error: g.ok ? undefined : g.error,
  };
}

/* --------------------------------------------------------------------------
 * Language coverage: Spanish queries with impressions and no Spanish page.
 * ------------------------------------------------------------------------ */
const SPANISH =
  /\b(abogad[oa]s?|despido|injustificado|trabajo|salario|sueldo|horas extras|empleador|patr[oó]n|demanda|acoso|discriminaci[oó]n|derechos|cu[aá]nto|c[oó]mo|qu[eé]|d[oó]nde|para|por|del|los|las|una)\b|[ñáéíóú]/i;

async function language(tenantId: string): Promise<GapResult> {
  const sb = getSupabaseAdmin();
  const [g, pages, drafts] = await Promise.all([
    gscQueries(tenantId, { days: 28, withPage: false }),
    sb.from("site_pages").select("url, title").eq("tenant_id", tenantId).limit(3000),
    sb.from("content_drafts").select("id, title, metadata, status").eq("tenant_id", tenantId).in("status", ["published", "approved"]).limit(2000),
  ]);
  if (!g.ok) return { view: "language", items: [], summary: [], error: g.error };
  const spanishPages = [
    ...(pages.data ?? []).filter((p) => /\/es\//.test(String(p.url)) || SPANISH.test(String(p.title ?? ""))).map((p) => String(p.title ?? p.url)),
    ...(drafts.data ?? []).filter((d) => (d.metadata as { language?: string } | null)?.language === "es").map((d) => String(d.title ?? "")),
  ];
  const spanishTok = spanishPages.map((t) => intentTokens(t));
  const items: GapItem[] = g.rows
    .filter((r) => r.impressions > 0 && SPANISH.test(r.query) && !/\b(new york|lawyer|attorney)\b/i.test(r.query))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40)
    .filter((r) => !spanishTok.some((t) => coverage(intentTokens(r.query), t) >= 0.99))
    .map((r) => ({
      title: r.query,
      detail: `${r.impressions} impressions, position ${r.position.toFixed(1)}, no Spanish page`,
      source: `Search Console, 28 days to ${day(g.fetchedAt)}`,
      action: { kind: "brief" as const, keyword: r.query, language: "es" as const },
    }));
  return { view: "language", items, summary: [`${spanishPages.length} Spanish pages or published drafts found.`] };
}

/* --------------------------------------------------------------------------
 * Question patterns: question queries that earn clicks, and siblings from
 * DataForSEO suggestions and People Also Ask, each overlap-checked.
 * ------------------------------------------------------------------------ */
const QUESTION = /^(can|how|what|when|is|are|do|does|why|should|will|if|who|where)\b/i;

async function questions(tenantId: string): Promise<GapResult> {
  const [g, targets] = await Promise.all([gscQueries(tenantId, { days: 28, withPage: false }), loadExistingTargets(tenantId)]);
  if (!g.ok) return { view: "questions", items: [], summary: [], error: g.error };
  const winners = g.rows.filter((r) => r.clicks > 0 && QUESTION.test(r.query)).sort((a, b) => b.clicks - a.clicks).slice(0, 6);
  const items: GapItem[] = [];
  for (const w of winners) {
    const stem = w.query.split(/\s+/).slice(0, 4).join(" ");
    const [sugg, paa] = await Promise.all([
      getKeywordSuggestions(stem, 30).catch(() => []),
      getPeopleAlsoAsk(w.query).catch(() => []),
    ]);
    const siblings = [
      ...sugg.filter((s) => QUESTION.test(s.keyword) && s.keyword !== w.query).slice(0, 6).map((s) => ({ q: s.keyword, from: `DataForSEO ${s.searchVolume}/mo` })),
      ...paa.slice(0, 4).map((q) => ({ q: q.toLowerCase().replace(/\?$/, ""), from: "People Also Ask" })),
    ];
    for (const s of siblings) {
      const tok = intentTokens(s.q);
      const hit = targets.find((t) => coverage(tok, intentTokens(t.text)) >= 0.99);
      items.push({
        title: s.q,
        detail: `Sibling of "${w.query}" (${w.clicks} clicks, position ${w.position.toFixed(1)})`,
        rows: [{ label: "Overlap", value: hit ? `covered by ${hit.label}` : "not targeted yet" }],
        source: s.from,
        action: hit ? null : { kind: "brief", keyword: s.q },
      });
    }
  }
  return { view: "questions", items, summary: [`${winners.length} question queries earning clicks in the last 28 days.`] };
}

export async function contentGap(view: GapView, tenantId: string): Promise<GapResult> {
  switch (view) {
    case "striking":
      return striking(tenantId);
    case "missing":
      return missing(tenantId);
    case "clusters":
      return clusters(tenantId);
    case "states":
      return states(tenantId);
    case "language":
      return language(tenantId);
    case "questions":
      return questions(tenantId);
  }
}
