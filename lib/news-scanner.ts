/**
 * Google News tracker via public RSS.
 *
 * Pulls news headlines matching NY/NJ employment-law topics. Different goal
 * than the Reddit/HN scanners: we're not looking for posts to engage with,
 * we're looking for news pegs to write reactive content about. Each item
 * shows publisher, headline, snippet, and time.
 */

import { logger } from "./logger";

export type NewsItem = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  publisher: string;
  created: number;
  matchedKeywords: string[];
  relevanceScore: number;
};

export type NewsScanResult = {
  items: NewsItem[];
  totalFound: number;
  scannedAt: string;
};

// Each query gets its own Google News RSS feed.
const QUERIES = [
  '"New York" employment law',
  '"New Jersey" employment law',
  "NYC wage theft",
  "NYC wrongful termination",
  "New York harassment lawsuit",
  "NYC discrimination ruling",
  "NY severance lawsuit",
  "FLSA New York",
  "NYSHRL ruling",
  "NJ LAD ruling",
];

const KEYWORDS = [
  "employment",
  "wage theft",
  "wrongful termination",
  "discrimination",
  "harassment",
  "retaliation",
  "severance",
  "non-compete",
  "FLSA",
  "FMLA",
  "NYSHRL",
  "NJLAD",
  "EEOC",
  "DOL",
  "labor",
  "lawsuit",
  "ruling",
  "settled",
];

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

type ParsedItem = {
  title: string;
  link: string;
  description: string;
  pubDate: number;
  publisher: string;
};

function parseRssItems(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.split(/<item>/g).slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/);
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

    if (!titleMatch || !linkMatch) continue;
    const titleRaw = decode(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim());
    // Google News appends " - Publisher Name" — strip it cleanly.
    const dashIdx = titleRaw.lastIndexOf(" - ");
    const title = dashIdx > -1 ? titleRaw.slice(0, dashIdx) : titleRaw;
    const fallbackPublisher = dashIdx > -1 ? titleRaw.slice(dashIdx + 3) : "";
    const publisher = sourceMatch
      ? decode(sourceMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim())
      : fallbackPublisher;

    items.push({
      title,
      link: linkMatch[1].trim(),
      description: descMatch
        ? decode(descMatch[1])
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : "",
      pubDate: dateMatch ? Math.floor(new Date(dateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
      publisher,
    });
  }
  return items;
}

async function fetchGoogleNews(query: string): Promise<ParsedItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "KMDashboard/1.0 (news-scanner)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ query, status: res.status }, "Google News non-200");
      return [];
    }
    const xml = await res.text();
    return parseRssItems(xml);
  } catch (err) {
    logger.warn(
      { query, error: err instanceof Error ? err.message : String(err) },
      "Google News fetch failed",
    );
    return [];
  }
}

function relevance(item: ParsedItem): { score: number; matched: string[] } {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  for (const kw of KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      matched.push(kw);
      score += 12;
    }
  }
  if (text.includes("new york") || text.includes("nyc")) {
    score += 10;
    matched.push("Location: New York");
  } else if (text.includes("new jersey") || text.includes("nj ")) {
    score += 10;
    matched.push("Location: New Jersey");
  }
  const hours = (Date.now() / 1000 - item.pubDate) / 3600;
  if (hours < 24) score += 12;
  else if (hours < 72) score += 6;
  else if (hours < 168) score += 2;
  return { score: Math.min(score, 100), matched };
}

export async function scanNews(): Promise<NewsScanResult> {
  const settled = await Promise.allSettled(QUERIES.map((q) => fetchGoogleNews(q)));
  const seen = new Set<string>();
  const out: NewsItem[] = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const id = item.link;
      if (seen.has(id)) continue;
      seen.add(id);
      const { score, matched } = relevance(item);
      if (score < 12) continue;
      out.push({
        id,
        title: item.title,
        snippet: item.description.slice(0, 400),
        url: item.link,
        publisher: item.publisher,
        created: item.pubDate,
        matchedKeywords: matched,
        relevanceScore: score,
      });
    }
  }

  out.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return {
    items: out.slice(0, 50),
    totalFound: out.length,
    scannedAt: new Date().toISOString(),
  };
}
