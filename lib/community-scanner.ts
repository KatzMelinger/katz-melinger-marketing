/**
 * Reddit RSS scanner + relevance scoring for the /community page.
 *
 * Reddit exposes public Atom RSS feeds for every subreddit (no API key
 * required, no rate limit headache for low-volume scans). We pull recent
 * posts from a curated list of employment-law-relevant subs, score each
 * post for relevance to a NY/NJ plaintiff-side employment firm, and return
 * the top hits.
 *
 * Quora and Avvo use bot protection that defeats automated scanning, so
 * those platforms are handled via curated launcher links + a paste-a-
 * question UI on the page itself.
 */

import { logger } from "./logger";

export type ScanPost = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  subreddit: string;
  author: string;
  created: number; // unix seconds
  relevanceScore: number; // 0-100
  matchedKeywords: string[];
};

export type ScanResult = {
  posts: ScanPost[];
  subredditsScanned: string[];
  totalFound: number;
  scannedAt: string;
};

const EMPLOYMENT_KEYWORDS = [
  "wrongful termination",
  "fired illegally",
  "employment discrimination",
  "workplace harassment",
  "sexual harassment",
  "hostile work environment",
  "unpaid wages",
  "unpaid overtime",
  "wage theft",
  "retaliation",
  "whistleblower",
  "FMLA",
  "pregnancy discrimination",
  "disability discrimination",
  "age discrimination",
  "racial discrimination",
  "severance agreement",
  "non-compete",
  "non compete",
  "employment contract",
  "unemployment denied",
  "workers comp",
  "labor law",
  "workplace rights",
  "can my employer",
  "is it legal",
  "employment lawyer",
  "HR won't help",
  "employer broke the law",
  "wrongfully fired",
];

const NY_NJ_TERMS = [
  "new york",
  "nyc",
  "new jersey",
  "nj",
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
  "newark",
  "jersey city",
];

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

type RawEntry = {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  permalink: string;
  url: string;
  created_utc: number;
};

function parseAtomEntry(entry: string, fallbackSub: string): RawEntry | null {
  const titleMatch = entry.match(/<title[^>]*>(.*?)<\/title>/s);
  const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
  const contentMatch = entry.match(/<content[^>]*>(.*?)<\/content>/s);
  const updatedMatch = entry.match(/<updated[^>]*>(.*?)<\/updated>/s);
  const authorMatch = entry.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/);
  const subreddit = (entry.match(/\/r\/([^/]+)\//) ?? [, fallbackSub])[1];

  if (!titleMatch || !linkMatch) return null;

  const title = decodeEntities(titleMatch[1].trim());
  const link = linkMatch[1];
  const idMatch = link.match(/comments\/([a-z0-9]+)/);
  const id = idMatch ? idMatch[1] : `${subreddit}-${title.slice(0, 32)}`;

  const cleanContent = contentMatch
    ? decodeEntities(contentMatch[1])
        .replace(/<!--\s*SC_(OFF|ON)\s*-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

  return {
    id,
    title,
    selftext: cleanContent.slice(0, 500),
    subreddit: subreddit ?? fallbackSub,
    author: authorMatch ? authorMatch[1].replace(/^\/u\//, "") : "anonymous",
    permalink: link.replace("https://www.reddit.com", ""),
    url: link,
    created_utc: updatedMatch ? Math.floor(new Date(updatedMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
  };
}

async function fetchSubredditFeed(subreddit: string): Promise<RawEntry[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.rss?limit=25`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "KMDashboard/1.0 (community-scanner; +https://katzmelinger.com)",
        Accept: "application/atom+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ subreddit, status: res.status }, "Reddit RSS non-200");
      return [];
    }
    const xml = await res.text();
    const entries = xml.split(/<entry>/g).slice(1);
    const parsed: RawEntry[] = [];
    for (const e of entries) {
      const row = parseAtomEntry(e, subreddit);
      if (row) parsed.push(row);
    }
    return parsed;
  } catch (err) {
    logger.warn(
      { subreddit, error: err instanceof Error ? err.message : String(err) },
      "Reddit RSS fetch failed",
    );
    return [];
  }
}

function calculateRelevance(post: RawEntry): { score: number; matched: string[] } {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  const matched: string[] = [];

  let score = 0;
  for (const kw of EMPLOYMENT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      matched.push(kw);
      score += 18;
    }
  }
  for (const term of NY_NJ_TERMS) {
    if (text.includes(term)) {
      score += 12;
      matched.push(`Location: ${term}`);
      break; // count location only once
    }
  }

  // Recency boost.
  const hoursOld = (Date.now() / 1000 - post.created_utc) / 3600;
  if (hoursOld < 6) score += 12;
  else if (hoursOld < 24) score += 8;
  else if (hoursOld < 48) score += 4;

  return { score: Math.min(score, 100), matched };
}

export async function scanReddit(): Promise<ScanResult> {
  const subs = [
    "legaladvice",
    "AskHR",
    "jobs",
    "careerguidance",
    "antiwork",
    "WorkReform",
    "newjersey",
    "nyc",
    "employment",
    "laborlaw",
    "Workers",
  ];

  const settled = await Promise.allSettled(subs.map((s) => fetchSubredditFeed(s)));
  const seen = new Set<string>();
  const out: ScanPost[] = [];

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const raw of result.value) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const { score, matched } = calculateRelevance(raw);
      if (score < 12) continue; // filter out clearly off-topic
      out.push({
        id: raw.id,
        title: raw.title,
        snippet: raw.selftext,
        url: raw.url,
        subreddit: raw.subreddit,
        author: raw.author,
        created: raw.created_utc,
        relevanceScore: score,
        matchedKeywords: matched,
      });
    }
  }

  out.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const top = out.slice(0, 60);

  return {
    posts: top,
    subredditsScanned: subs,
    totalFound: top.length,
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Curated launcher links for Quora and Avvo (no scraping — bot-protected)
// ---------------------------------------------------------------------------

export const QUORA_LINKS: { label: string; url: string }[] = [
  { label: "Employment Law (topic)", url: "https://www.quora.com/topic/Employment-Law" },
  { label: "Wage & Hour Law (topic)", url: "https://www.quora.com/topic/Wage-and-Hour-Law" },
  { label: "Workplace Discrimination", url: "https://www.quora.com/topic/Workplace-Discrimination" },
  { label: "Sexual Harassment at Work", url: "https://www.quora.com/topic/Sexual-Harassment-1" },
  { label: "Severance (topic)", url: "https://www.quora.com/topic/Severance-Pay" },
  { label: "Search: NYC employment", url: "https://www.quora.com/search?q=NYC%20employment%20lawyer" },
  { label: "Search: wrongful termination", url: "https://www.quora.com/search?q=wrongful%20termination%20New%20York" },
  { label: "Search: unpaid wages", url: "https://www.quora.com/search?q=unpaid%20wages%20New%20York" },
  { label: "Search: NJ employment", url: "https://www.quora.com/search?q=New%20Jersey%20employment%20law" },
];

export const AVVO_LINKS: { label: string; url: string }[] = [
  { label: "Employment Q&A — New York", url: "https://www.avvo.com/topics/employment/legal-question-and-answer/state/ny" },
  { label: "Employment Q&A — New Jersey", url: "https://www.avvo.com/topics/employment/legal-question-and-answer/state/nj" },
  { label: "Wrongful Termination — NY", url: "https://www.avvo.com/topics/wrongful-termination/legal-question-and-answer/state/ny" },
  { label: "Wage & Hour — NY", url: "https://www.avvo.com/topics/wage-hour/legal-question-and-answer/state/ny" },
  { label: "Discrimination — NY", url: "https://www.avvo.com/topics/discrimination/legal-question-and-answer/state/ny" },
  { label: "Harassment — NY", url: "https://www.avvo.com/topics/harassment/legal-question-and-answer/state/ny" },
  { label: "Severance — NY", url: "https://www.avvo.com/topics/severance/legal-question-and-answer/state/ny" },
  { label: "FMLA — NY", url: "https://www.avvo.com/topics/fmla/legal-question-and-answer/state/ny" },
  { label: "Q&A by City: NYC", url: "https://www.avvo.com/all-lawyers/ny/new_york_city.html" },
];
