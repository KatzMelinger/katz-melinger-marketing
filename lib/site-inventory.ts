/**
 * Site inventory crawler — builds the automated cluster map in `site_pages`.
 *
 * Flow:
 *   1. Resolve the sitemap (handles sitemap-index → sub-sitemaps, WordPress/
 *      Yoast style) into a flat list of page URLs.
 *   2. Fetch each page's <title> + first <h1> (concurrency-limited).
 *   3. Classify page_type by URL pattern; classify pillar + topics with one
 *      batched Claude call over all titles.
 *   4. Upsert into site_pages. Human pillar overrides (pillar_locked=true)
 *      are preserved across re-crawls.
 *
 * Used by /api/content/site-inventory/crawl (manual + daily cron).
 */

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { ALL_KM_PILLARS } from "@/lib/km-content-system";

const USER_AGENT = "Mozilla/5.0 (compatible; KMSiteInventory/0.1; +https://katzmelinger.com)";
const MAX_PAGES = 300;
const FETCH_CONCURRENCY = 8;

export type SitePageType =
  | "blog_post"
  | "service_page"
  | "pillar"
  | "cluster"
  | "case_result"
  | "practice_area"
  | "other";

export type SitePage = {
  id: string;
  url: string;
  title: string | null;
  h1: string | null;
  page_type: SitePageType;
  pillar: string | null;
  practice_area: string | null;
  topics: string[];
  summary: string | null;
  pillar_locked: boolean;
  last_crawled_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Sitemap resolution (self-contained; mirrors lib/internal-link-audit.ts).
// ---------------------------------------------------------------------------
function normalizeUrl(u: string, host: string): string | null {
  try {
    const parsed = new URL(u);
    if (parsed.host.replace(/^www\./, "") !== host) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function resolveSitemapUrls(base: string, host: string): Promise<string[]> {
  const MAX_DEPTH = 3;
  const visited = new Set<string>();
  const pages = new Set<string>();

  async function expand(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);
    let xml = "";
    try {
      const res = await fetch(sitemapUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) return;
      xml = await res.text();
    } catch {
      return;
    }
    const isIndex = /<sitemapindex\b/i.test(xml);
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    const subs: string[] = [];
    while ((m = re.exec(xml)) !== null) {
      const u = m[1].trim();
      if (!u) continue;
      if (isIndex || /\.xml(\.gz)?(\?|$)/i.test(u)) subs.push(u);
      else {
        const n = normalizeUrl(u, host);
        if (n) pages.add(n);
      }
    }
    for (const sub of subs) await expand(sub, depth + 1);
  }

  await expand(`${base}/sitemap.xml`, 0);
  if (pages.size === 0) await expand(`${base}/sitemap_index.xml`, 0);
  return Array.from(pages);
}

// ---------------------------------------------------------------------------
// Per-page title + h1 fetch.
// ---------------------------------------------------------------------------
async function fetchTitleH1(
  url: string,
): Promise<{ title: string | null; h1: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return { title: null, h1: null };
    const html = (await res.text()).slice(0, 60_000);
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const clean = (s: string | undefined) =>
      s
        ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300)
        : null;
    return { title: clean(titleM?.[1]) ?? null, h1: clean(h1M?.[1]) ?? null };
  } catch {
    return { title: null, h1: null };
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// URL-pattern page_type classification (cheap, deterministic).
// ---------------------------------------------------------------------------
function classifyTypeByUrl(url: string): SitePageType {
  const p = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\/blog\//.test(p) || /\/\d{4}\/\d{2}\//.test(p)) return "blog_post";
  if (/case-result|case-results|results|verdict|settlement/.test(p))
    return "case_result";
  if (/practice-area|practice-areas/.test(p)) return "practice_area";
  // Pillar URLs come from the known pillar list.
  if (ALL_KM_PILLARS.some((pl) => p.replace(/\/$/, "") === pl.url.replace(/\/$/, "")))
    return "pillar";
  return "service_page";
}

// ---------------------------------------------------------------------------
// Batched pillar + topic classification via Claude.
// ---------------------------------------------------------------------------
type Classification = {
  url: string;
  pillar: string | null;
  practice_area: string | null;
  topics: string[];
};

async function classifyPillars(
  pages: { url: string; title: string | null; h1: string | null }[],
): Promise<Map<string, Classification>> {
  const out = new Map<string, Classification>();
  if (pages.length === 0) return out;

  const pillarList = ALL_KM_PILLARS.map(
    (p) => `- ${p.id} (${p.label}, ${p.practiceArea})`,
  ).join("\n");

  // Batch in groups of 50 to keep each Claude call small.
  for (let i = 0; i < pages.length; i += 50) {
    const batch = pages.slice(i, i + 50);
    const listing = batch
      .map(
        (p, idx) =>
          `${idx + 1}. ${p.title ?? p.h1 ?? "(untitled)"} — ${p.url}`,
      )
      .join("\n");

    try {
      const resp = await getAnthropic().messages.create({
        model: KEYWORD_RESEARCH_MODEL,
        max_tokens: 4096,
        system: `You classify a law firm's web pages into content pillars. The firm's pillars:\n${pillarList}\n\nFor each page, pick the single best matching pillar id (or null if none fit), the practice_area ('employment' or 'collections' or null), and 1-4 short topic tags drawn from the page title. Be precise — only assign a pillar when the page is clearly about it.`,
        tools: [
          {
            name: "return_classifications",
            description: "Return one classification per input page.",
            input_schema: {
              type: "object" as const,
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      pillar: { type: "string" },
                      practice_area: { type: "string" },
                      topics: { type: "array", items: { type: "string" } },
                    },
                    required: ["url", "topics"],
                  },
                },
              },
              required: ["items"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "return_classifications" },
        messages: [
          {
            role: "user",
            content: `Classify these ${batch.length} pages:\n${listing}`,
          },
        ],
      });
      const toolUse = resp.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        const input = toolUse.input as {
          items?: Array<{
            url?: string;
            pillar?: string;
            practice_area?: string;
            topics?: string[];
          }>;
        };
        const validPillars = new Set(ALL_KM_PILLARS.map((p) => p.id));
        for (const it of input.items ?? []) {
          if (!it.url) continue;
          out.set(it.url, {
            url: it.url,
            pillar:
              it.pillar && validPillars.has(it.pillar) ? it.pillar : null,
            practice_area:
              it.practice_area === "employment" ||
              it.practice_area === "collections"
                ? it.practice_area
                : null,
            topics: Array.isArray(it.topics)
              ? it.topics.filter((t) => typeof t === "string").slice(0, 4)
              : [],
          });
        }
      }
    } catch {
      // Classification batch failed — pages still get stored without a pillar.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------------
export async function crawlSiteInventory(args?: {
  domain?: string;
  maxPages?: number;
}): Promise<{ crawled: number; classified: number; skipped: number }> {
  const domain = (args?.domain ?? "katzmelinger.com").trim();
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const host = new URL(base).host.replace(/^www\./, "");

  const urls = (await resolveSitemapUrls(base, host)).slice(
    0,
    args?.maxPages ?? MAX_PAGES,
  );
  if (urls.length === 0) {
    return { crawled: 0, classified: 0, skipped: 0 };
  }

  // Fetch titles/h1 concurrently.
  const fetched = await mapLimit(urls, FETCH_CONCURRENCY, async (url) => {
    const { title, h1 } = await fetchTitleH1(url);
    return { url, title, h1 };
  });
  const usable = fetched.filter((f) => f.title || f.h1);

  // Classify pillars in batches.
  const classMap = await classifyPillars(usable);

  // Load existing rows to preserve human pillar overrides.
  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("site_pages")
    .select("url, pillar, pillar_locked");
  const locked = new Map<string, string | null>();
  for (const r of existing ?? []) {
    if (r.pillar_locked) locked.set(r.url as string, (r.pillar as string) ?? null);
  }

  const now = new Date().toISOString();
  const rows = usable.map((f) => {
    const cls = classMap.get(f.url);
    const isLocked = locked.has(f.url);
    return {
      url: f.url,
      title: f.title,
      h1: f.h1,
      page_type: classifyTypeByUrl(f.url),
      pillar: isLocked ? locked.get(f.url) ?? null : cls?.pillar ?? null,
      practice_area: cls?.practice_area ?? null,
      topics: cls?.topics ?? [],
      last_crawled_at: now,
    };
  });

  // Upsert in chunks.
  let classified = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sb
      .from("site_pages")
      .upsert(chunk, { onConflict: "url" });
    if (!error) classified += chunk.filter((c) => c.pillar).length;
  }

  return {
    crawled: rows.length,
    classified,
    skipped: urls.length - usable.length,
  };
}

/**
 * Lightweight per-URL ingest — used to refresh the cluster map immediately
 * when a single new page is published, without running the full sitemap crawl.
 * Fetches title/h1 for each URL, classifies type by URL pattern + pillar via
 * one batched Claude call, then upserts. Preserves human pillar overrides.
 */
export async function ingestUrls(
  rawUrls: string[],
): Promise<{ ingested: number; classified: number; skipped: number }> {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of rawUrls) {
    try {
      const parsed = new URL(u);
      const normalized = parsed.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      /* invalid URL — skip */
    }
  }
  if (urls.length === 0) {
    return { ingested: 0, classified: 0, skipped: 0 };
  }

  const fetched = await mapLimit(urls, FETCH_CONCURRENCY, async (url) => {
    const { title, h1 } = await fetchTitleH1(url);
    return { url, title, h1 };
  });
  const usable = fetched.filter((f) => f.title || f.h1);
  if (usable.length === 0) {
    return {
      ingested: 0,
      classified: 0,
      skipped: urls.length,
    };
  }

  const classMap = await classifyPillars(usable);

  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("site_pages")
    .select("url, pillar, pillar_locked")
    .in("url", usable.map((u) => u.url));
  const locked = new Map<string, string | null>();
  for (const r of existing ?? []) {
    if (r.pillar_locked) locked.set(r.url as string, (r.pillar as string) ?? null);
  }

  const now = new Date().toISOString();
  const rows = usable.map((f) => {
    const cls = classMap.get(f.url);
    const isLocked = locked.has(f.url);
    return {
      url: f.url,
      title: f.title,
      h1: f.h1,
      page_type: classifyTypeByUrl(f.url),
      pillar: isLocked ? locked.get(f.url) ?? null : cls?.pillar ?? null,
      practice_area: cls?.practice_area ?? null,
      topics: cls?.topics ?? [],
      last_crawled_at: now,
    };
  });

  const { error } = await sb
    .from("site_pages")
    .upsert(rows, { onConflict: "url" });
  if (error) {
    throw new Error(`ingest upsert failed: ${error.message}`);
  }

  return {
    ingested: rows.length,
    classified: rows.filter((r) => r.pillar).length,
    skipped: urls.length - usable.length,
  };
}

export async function listSitePages(opts?: {
  pillar?: string;
  pageType?: SitePageType;
}): Promise<SitePage[]> {
  const sb = getSupabaseAdmin();
  let q = sb
    .from("site_pages")
    .select("*")
    .order("pillar", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true })
    .limit(1000);
  if (opts?.pillar) q = q.eq("pillar", opts.pillar);
  if (opts?.pageType) q = q.eq("page_type", opts.pageType);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SitePage[];
}

export async function setSitePagePillar(
  id: string,
  pillar: string | null,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("site_pages")
    .update({ pillar, pillar_locked: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
