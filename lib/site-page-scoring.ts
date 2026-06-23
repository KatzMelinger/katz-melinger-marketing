/**
 * Site Inventory page scoring — fetches each published page and runs the same
 * SEO/AEO/CASH scorers the draft analyzer uses, persisting the scores onto
 * site_pages. Powers the Site Inventory "Optimize" tab (pages below standard).
 *
 * Run monthly by /api/content/site-inventory/score (cron) or on demand from the
 * "Score pages" button. Bounded per run (limit + concurrency + a stale cutoff)
 * so one invocation can't run away on a large site or blow the function timeout.
 */

import { scorePageContent } from "@/lib/content-analysis";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// Only score real content pages — skip 'other' (contact, privacy, utility).
const SCORE_TYPES = [
  "blog_post",
  "service_page",
  "pillar",
  "cluster",
  "case_result",
  "practice_area",
];
const RESCORE_AFTER_DAYS = 25; // re-score pages older than this; monthly cadence
const DEFAULT_LIMIT = 60; // max pages scored per run (timeout/cost guard)
const CONCURRENCY = 4; // parallel page fetch+score

const UA = "Mozilla/5.0 (compatible; KMDashboard/1.0)";

/** Fetch a live page and reduce it to readable body text for scoring. */
export async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const html = await res.text();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const raw = bodyMatch ? bodyMatch[1] : html;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type StaleRow = { id: string; url: string; title: string | null };

function staleFilter(cutoffIso: string) {
  // Never scored, or scored before the cutoff.
  return `scored_at.is.null,scored_at.lt.${cutoffIso}`;
}

/**
 * Score a bounded batch of this tenant's content pages that are unscored or
 * stale, writing seo/aeo/cash + scored_at back onto site_pages.
 */
export async function scoreSitePages(args: {
  tenantId: string;
  limit?: number;
}): Promise<{ scored: number; failed: number; remaining: number }> {
  const sb = getSupabaseAdmin();
  const limit = args.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - RESCORE_AFTER_DAYS * 86_400_000).toISOString();

  const { data, error } = await sb
    .from("site_pages")
    .select("id, url, title, scored_at")
    .eq("tenant_id", args.tenantId)
    .in("page_type", SCORE_TYPES)
    .or(staleFilter(cutoff))
    .order("scored_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const queue = (data ?? []) as StaleRow[];
  let scored = 0;
  let failed = 0;

  const worker = async () => {
    for (;;) {
      const page = queue.shift();
      if (!page) return;
      try {
        const text = await fetchPageText(page.url);
        if (text.length < 200) {
          failed++; // too thin to score meaningfully
          continue;
        }
        const s = await scorePageContent({ body: text, title: page.title });
        await sb
          .from("site_pages")
          .update({
            seo_score: s.seo,
            aeo_score: s.aeo,
            cash_score: s.cash,
            scored_at: new Date().toISOString(),
          })
          .eq("tenant_id", args.tenantId)
          .eq("id", page.id);
        scored++;
      } catch {
        failed++;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker),
  );

  // How many still need scoring after this run (just-scored rows now fall out).
  const { count } = await sb
    .from("site_pages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", args.tenantId)
    .in("page_type", SCORE_TYPES)
    .or(staleFilter(cutoff));

  return { scored, failed, remaining: count ?? 0 };
}
