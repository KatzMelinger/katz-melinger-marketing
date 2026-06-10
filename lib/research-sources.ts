/**
 * Live "People Ask & Trends" source connectors used by the research layer.
 *
 * Each connector is best-effort and isolated: if its API key / OAuth /
 * network is unavailable it returns [] (plus a note) rather than throwing,
 * so one dead source never kills a research run. The packet generator runs
 * them in parallel and merges.
 *
 * Sources:
 *   - Semrush question keywords  (uses existing SEMRUSH_API_KEY)
 *   - Search Console queries     (uses existing GBP/Google OAuth, webmasters scope)
 *   - Google Autocomplete        (free public endpoint)
 *   - Reddit                     (public search.json, no key; may be IP-limited)
 *   - YouTube                    (needs YOUTUBE_API_KEY)
 */

import { getPhraseMetrics } from "@/lib/dataforseo";
import { getGoogleAccessToken } from "@/lib/google-access-token";
import { gscSiteUrlEncoded } from "@/lib/gsc-site-url";
import type { PeopleAskSourceType } from "@/lib/research-libraries";

export type RawAskItem = {
  content: string;
  source_type: PeopleAskSourceType;
  source_url?: string | null;
  metric?: Record<string, unknown>;
  trend_signal?: string | null;
};

export type ConnectorResult = {
  source: PeopleAskSourceType;
  items: RawAskItem[];
  note: string | null; // null = ran clean; string = why it's empty
};

const QUESTION_STEMS = [
  "how to",
  "what is",
  "can i",
  "do i",
  "what happens if",
  "how long",
  "how much",
  "when can",
  "is it legal to",
  "what are my rights",
];

function dedupe(items: RawAskItem[]): RawAskItem[] {
  const seen = new Set<string>();
  const out: RawAskItem[] = [];
  for (const it of items) {
    const key = it.content.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semrush — check volume on question-stem variants of the topic.
// ---------------------------------------------------------------------------
export async function semrushQuestions(topic: string): Promise<ConnectorResult> {
  if (!process.env.SEMRUSH_API_KEY?.trim()) {
    return { source: "semrush", items: [], note: "SEMRUSH_API_KEY not set" };
  }
  const phrases = QUESTION_STEMS.map((stem) => `${stem} ${topic}`.toLowerCase());
  try {
    const metrics = await getPhraseMetrics(phrases);
    const items: RawAskItem[] = [];
    for (const [phrase, m] of metrics) {
      if (m.volume > 0) {
        items.push({
          content: phrase,
          source_type: "semrush",
          metric: { volume: m.volume, cpc: m.cpc, competition: m.competition },
        });
      }
    }
    return {
      source: "semrush",
      items: dedupe(items),
      note: items.length === 0 ? "no question variants with volume" : null,
    };
  } catch (err) {
    return {
      source: "semrush",
      items: [],
      note: err instanceof Error ? err.message : "semrush failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Search Console — real queries, filtered to ones related to the topic.
// ---------------------------------------------------------------------------
export async function searchConsoleQuestions(
  topic: string,
): Promise<ConnectorResult> {
  const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return { source: "search_console", items: [], note: auth.error };
  }
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${gscSiteUrlEncoded()}/searchAnalytics/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(start),
        endDate: ymd(end),
        dimensions: ["query"],
        rowLimit: 200,
        orderBy: [{ field: "impressions", sortOrder: "descending" }],
      }),
    });
    const json = (await res.json()) as {
      rows?: {
        keys?: string[];
        clicks?: number;
        impressions?: number;
        position?: number;
      }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        source: "search_console",
        items: [],
        note: json.error?.message ?? `GSC ${res.status}`,
      };
    }
    const topicWords = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const items: RawAskItem[] = (json.rows ?? [])
      .map((r) => ({
        query: (r.keys?.[0] ?? "").toLowerCase(),
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        position: r.position ?? 0,
      }))
      .filter(
        (r) =>
          r.query &&
          topicWords.some((w) => r.query.includes(w)) &&
          // bias toward question-shaped or longer-tail queries
          (/(how|what|can|do|when|why|is|are|should)/.test(r.query) ||
            r.query.split(/\s+/).length >= 4),
      )
      .map((r) => ({
        content: r.query,
        source_type: "search_console" as const,
        metric: {
          clicks: r.clicks,
          impressions: r.impressions,
          position: Math.round(r.position * 10) / 10,
        },
      }));
    return {
      source: "search_console",
      items: dedupe(items),
      note: items.length === 0 ? "no matching GSC queries" : null,
    };
  } catch (err) {
    return {
      source: "search_console",
      items: [],
      note: err instanceof Error ? err.message : "GSC failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Google Autocomplete — free public suggest endpoint.
// ---------------------------------------------------------------------------
export async function googleAutocomplete(
  topic: string,
): Promise<ConnectorResult> {
  const seeds = [topic, ...QUESTION_STEMS.map((s) => `${s} ${topic}`)];
  const items: RawAskItem[] = [];
  try {
    for (const seed of seeds) {
      const u = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(
        seed,
      )}`;
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (KMResearch/0.1)" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as [string, string[]];
      const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
      for (const s of suggestions) {
        items.push({
          content: s,
          source_type: "autocomplete",
          source_url: `https://www.google.com/search?q=${encodeURIComponent(s)}`,
        });
      }
    }
    return {
      source: "autocomplete",
      items: dedupe(items),
      note: items.length === 0 ? "no autocomplete suggestions" : null,
    };
  } catch (err) {
    return {
      source: "autocomplete",
      items: dedupe(items),
      note: err instanceof Error ? err.message : "autocomplete failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Reddit — public search JSON (no key; can be IP-rate-limited on servers).
// ---------------------------------------------------------------------------
export async function redditQuestions(topic: string): Promise<ConnectorResult> {
  const u = `https://www.reddit.com/search.json?q=${encodeURIComponent(
    topic,
  )}&sort=relevance&t=year&limit=25`;
  try {
    const res = await fetch(u, {
      headers: { "User-Agent": "web:km-research:v0.1 (by /u/katzmelinger)" },
    });
    if (!res.ok) {
      return {
        source: "reddit",
        items: [],
        note: `reddit ${res.status} (often IP-limited on servers)`,
      };
    }
    const json = (await res.json()) as {
      data?: { children?: { data?: { title?: string; permalink?: string; num_comments?: number } }[] };
    };
    const items: RawAskItem[] = (json.data?.children ?? [])
      .map((c) => c.data)
      .filter((d): d is NonNullable<typeof d> => Boolean(d?.title))
      .map((d) => ({
        content: d.title as string,
        source_type: "reddit" as const,
        source_url: d.permalink
          ? `https://www.reddit.com${d.permalink}`
          : null,
        metric: { num_comments: d.num_comments ?? 0 },
      }));
    return {
      source: "reddit",
      items: dedupe(items),
      note: items.length === 0 ? "no reddit results" : null,
    };
  } catch (err) {
    return {
      source: "reddit",
      items: [],
      note: err instanceof Error ? err.message : "reddit failed",
    };
  }
}

// ---------------------------------------------------------------------------
// YouTube — Data API search (needs YOUTUBE_API_KEY).
// ---------------------------------------------------------------------------
export async function youtubeQuestions(topic: string): Promise<ConnectorResult> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    return { source: "youtube", items: [], note: "YOUTUBE_API_KEY not set" };
  }
  const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(
    topic,
  )}&key=${key}`;
  try {
    const res = await fetch(u);
    const json = (await res.json()) as {
      items?: {
        id?: { videoId?: string };
        snippet?: { title?: string; channelTitle?: string };
      }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        source: "youtube",
        items: [],
        note: json.error?.message ?? `youtube ${res.status}`,
      };
    }
    const items: RawAskItem[] = (json.items ?? [])
      .filter((it) => it.snippet?.title)
      .map((it) => ({
        content: it.snippet!.title as string,
        source_type: "youtube" as const,
        source_url: it.id?.videoId
          ? `https://www.youtube.com/watch?v=${it.id.videoId}`
          : null,
        metric: { channel: it.snippet?.channelTitle ?? "" },
      }));
    return {
      source: "youtube",
      items: dedupe(items),
      note: items.length === 0 ? "no youtube results" : null,
    };
  } catch (err) {
    return {
      source: "youtube",
      items: [],
      note: err instanceof Error ? err.message : "youtube failed",
    };
  }
}

/**
 * Run every live connector in parallel. Returns per-source results so the UI
 * can show which sources contributed and which were skipped (and why).
 */
export async function gatherLiveSources(
  topic: string,
  enabled: PeopleAskSourceType[] = [
    "semrush",
    "search_console",
    "autocomplete",
    "reddit",
    "youtube",
  ],
): Promise<ConnectorResult[]> {
  const jobs: Promise<ConnectorResult>[] = [];
  if (enabled.includes("semrush")) jobs.push(semrushQuestions(topic));
  if (enabled.includes("search_console"))
    jobs.push(searchConsoleQuestions(topic));
  if (enabled.includes("autocomplete")) jobs.push(googleAutocomplete(topic));
  if (enabled.includes("reddit")) jobs.push(redditQuestions(topic));
  if (enabled.includes("youtube")) jobs.push(youtubeQuestions(topic));
  return Promise.all(jobs);
}
