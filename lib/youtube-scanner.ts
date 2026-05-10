/**
 * YouTube comment scanner using the YouTube Data API v3 (free, 10K
 * units/day quota — easily covers daily scans).
 *
 * Workflow:
 *   1. Search videos uploaded in the last ~30 days that match curated
 *      employment-law queries (search costs 100 units per query).
 *   2. Pick the top videos by view count + relevance.
 *   3. Fetch top comments on each video (1 unit per comment thread page).
 *   4. Score comments for keyword + NY/NJ + engagement signals.
 *   5. Return the highest-scoring comments with deep-links to the comment
 *      anchor on the video.
 *
 * Each scan typically uses ~600 quota units. The 10K daily cap means you
 * could run ~16 scans/day before hitting it.
 */

import { logger } from "./logger";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export type YouTubePost = {
  id: string;                    // commentId (parent comment id)
  title: string;                 // video title (used as the post headline)
  snippet: string;               // comment text
  url: string;                   // deep-link to the comment on the video
  videoId: string;
  videoTitle: string;
  channelTitle: string;
  author: string;                // commenter display name
  videoViews: number;
  likes: number;                 // likes on the comment
  created: number;               // unix seconds
  relevanceScore: number;
  matchedKeywords: string[];
};

export type YouTubeScanResult = {
  posts: YouTubePost[];
  videosScanned: number;
  totalFound: number;
  scannedAt: string;
};

const QUERIES = [
  "employment law NY",
  "wrongful termination",
  "workplace harassment",
  "wage theft",
  "severance negotiation",
  "non-compete agreement",
  "FMLA retaliation",
  "fired from job advice",
];

const KEYWORDS = [
  "wrongful termination",
  "fired",
  "discrimination",
  "harassment",
  "hostile work",
  "wage theft",
  "unpaid overtime",
  "severance",
  "non-compete",
  "retaliation",
  "whistleblower",
  "FMLA",
  "EEOC",
  "FLSA",
  "NYLL",
  "NYSHRL",
  "workplace rights",
  "employer broke",
  "is this legal",
  "can my employer",
  "can my boss",
  "lawyer",
  "sue my employer",
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
  "newark",
  "jersey city",
];

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new Error("YOUTUBE_API_KEY env var not set");
  return key;
}

type SearchVideo = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
};

async function searchVideos(query: string): Promise<SearchVideo[]> {
  const key = getApiKey();
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    order: "relevance",
    maxResults: "10",
    relevanceLanguage: "en",
    publishedAfter: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    key,
  });
  try {
    const res = await fetch(`${API_BASE}/search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn({ query, status: res.status, body: body.slice(0, 200) }, "YouTube search non-200");
      return [];
    }
    const data = (await res.json()) as {
      items?: {
        id?: { videoId?: string };
        snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
      }[];
    };
    return (data.items ?? [])
      .filter((it) => it.id?.videoId)
      .map((it) => ({
        id: it.id!.videoId!,
        title: it.snippet?.title ?? "(untitled)",
        channelTitle: it.snippet?.channelTitle ?? "",
        publishedAt: it.snippet?.publishedAt ?? "",
      }));
  } catch (err) {
    logger.warn(
      { query, error: err instanceof Error ? err.message : String(err) },
      "YouTube search failed",
    );
    return [];
  }
}

type VideoStats = { id: string; viewCount: number };

async function fetchVideoStats(ids: string[]): Promise<Map<string, VideoStats>> {
  if (ids.length === 0) return new Map();
  const key = getApiKey();
  const params = new URLSearchParams({
    part: "statistics",
    id: ids.join(","),
    key,
  });
  try {
    const res = await fetch(`${API_BASE}/videos?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as {
      items?: { id?: string; statistics?: { viewCount?: string } }[];
    };
    const map = new Map<string, VideoStats>();
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      map.set(item.id, { id: item.id, viewCount: Number(item.statistics?.viewCount ?? 0) });
    }
    return map;
  } catch {
    return new Map();
  }
}

type RawComment = {
  id: string;
  videoId: string;
  text: string;
  author: string;
  likes: number;
  publishedAt: number;
};

async function fetchTopComments(videoId: string): Promise<RawComment[]> {
  const key = getApiKey();
  const params = new URLSearchParams({
    part: "snippet",
    videoId,
    order: "relevance",     // YouTube's "top comments" sort
    maxResults: "20",
    textFormat: "plainText",
    key,
  });
  try {
    const res = await fetch(`${API_BASE}/commentThreads?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Common: comments disabled on the video — just skip silently.
      return [];
    }
    const data = (await res.json()) as {
      items?: {
        id?: string;
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              textDisplay?: string;
              authorDisplayName?: string;
              likeCount?: number;
              publishedAt?: string;
            };
          };
        };
      }[];
    };
    const out: RawComment[] = [];
    for (const item of data.items ?? []) {
      const top = item.snippet?.topLevelComment;
      const sn = top?.snippet;
      if (!top?.id || !sn?.textDisplay) continue;
      out.push({
        id: top.id,
        videoId,
        text: sn.textDisplay,
        author: sn.authorDisplayName ?? "anonymous",
        likes: sn.likeCount ?? 0,
        publishedAt: sn.publishedAt
          ? Math.floor(new Date(sn.publishedAt).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      });
    }
    return out;
  } catch (err) {
    logger.warn(
      { videoId, error: err instanceof Error ? err.message : String(err) },
      "YouTube commentThreads failed",
    );
    return [];
  }
}

function calculateRelevance(comment: RawComment): { score: number; matched: string[] } {
  const text = comment.text.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const kw of KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      matched.push(kw);
      score += 14;
    }
  }
  for (const term of NY_NJ_TERMS) {
    if (text.includes(term)) {
      score += 12;
      matched.push(`Location: ${term}`);
      break; // count location once
    }
  }
  // Comments asking for help (questions) tend to be the best engagement targets.
  if (/\?/.test(comment.text) || /^(can|is|does|should|how|what|who|why)/i.test(comment.text)) {
    score += 6;
    matched.push("Question");
  }
  // Engagement: comments with likes are higher-signal.
  if (comment.likes > 5) score += 6;
  if (comment.likes > 25) score += 4;
  // Recency.
  const hours = (Date.now() / 1000 - comment.publishedAt) / 3600;
  if (hours < 24) score += 8;
  else if (hours < 168) score += 4;
  return { score: Math.min(score, 100), matched };
}

export async function scanYouTube(): Promise<YouTubeScanResult> {
  const seenComments = new Set<string>();
  const seenVideos = new Map<string, SearchVideo>();
  let totalSearched = 0;

  // Step 1: search.
  const searchSettled = await Promise.allSettled(QUERIES.map((q) => searchVideos(q)));
  for (const r of searchSettled) {
    if (r.status !== "fulfilled") continue;
    for (const v of r.value) {
      seenVideos.set(v.id, v);
    }
    totalSearched += 1;
  }

  // Step 2: get view counts to rank videos.
  const videoIds = Array.from(seenVideos.keys());
  const stats = await fetchVideoStats(videoIds);
  const ranked = videoIds
    .map((id) => ({ id, views: stats.get(id)?.viewCount ?? 0 }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 25); // cap at 25 videos to stay well under quota

  // Step 3: fetch top comments per video, sequential to be polite to the API.
  const allPosts: YouTubePost[] = [];
  for (const v of ranked) {
    const meta = seenVideos.get(v.id)!;
    const comments = await fetchTopComments(v.id);
    for (const c of comments) {
      if (seenComments.has(c.id)) continue;
      seenComments.add(c.id);
      const { score, matched } = calculateRelevance(c);
      if (score < 14) continue; // higher floor than Reddit since YT comments are often noisy

      allPosts.push({
        id: c.id,
        title: meta.title,
        snippet: c.text.slice(0, 500),
        url: `https://www.youtube.com/watch?v=${c.videoId}&lc=${c.id}`,
        videoId: c.videoId,
        videoTitle: meta.title,
        channelTitle: meta.channelTitle,
        author: c.author,
        videoViews: v.views,
        likes: c.likes,
        created: c.publishedAt,
        relevanceScore: score,
        matchedKeywords: matched,
      });
    }
  }

  allPosts.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return {
    posts: allPosts.slice(0, 60),
    videosScanned: ranked.length,
    totalFound: allPosts.length,
    scannedAt: new Date().toISOString(),
  };
}
