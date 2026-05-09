/**
 * Post-processing for raw AEO responses.
 *
 * Given a response body and the targets we care about, this:
 *   - finds where each target was mentioned (and at what ordinal position)
 *   - classifies the sentiment of any sentence that mentions our firm
 *   - tags citations as "authority" sources (Wikipedia, Reddit, YouTube, etc)
 *
 * Sentiment is intentionally heuristic. It catches obvious positive/negative
 * adjectives and recommendation language; for finer-grained nuance, the AI
 * recommendations route can re-score with Claude on demand.
 */

import type { AEOCitation } from "./aeo-providers";

export type AEOTarget = {
  id: string;
  name: string;
  type: "self" | "competitor";
  domain: string | null;
  aliases: string[];
};

export type AEOBrandMention = {
  target_id: string;
  name: string;
  type: "self" | "competitor";
  /** 1-based ordinal: which brand was mentioned first, second, etc. */
  position: number;
  /** Number of times the target appears in the body. */
  occurrences: number;
  /** Sentiment of the closest sentence, if classifiable. */
  sentiment: "positive" | "neutral" | "negative" | "mixed" | null;
};

export type AEOAnalysisResult = {
  brandMentions: AEOBrandMention[];
  selfMentioned: boolean;
  selfPosition: number | null;
  selfSentiment: AEOBrandMention["sentiment"];
  authoritySources: string[];
};

// Domains AI models tend to lean on for trust signals. If our citations show
// up here, that's the AI proxy for "this brand is established."
const AUTHORITY_DOMAINS = new Set<string>([
  "wikipedia.org",
  "reddit.com",
  "youtube.com",
  "g2.com",
  "trustpilot.com",
  "yelp.com",
  "avvo.com",
  "martindale.com",
  "superlawyers.com",
  "findlaw.com",
  "nolo.com",
  "justia.com",
  "lawyers.com",
  "nybar.org",
  "nysba.org",
  "linkedin.com",
  "forbes.com",
  "nytimes.com",
  "wsj.com",
  "bloomberg.com",
  "reuters.com",
  "law360.com",
  "abovethelaw.com",
]);

const POSITIVE_TOKENS = [
  "recommend",
  "recommended",
  "top",
  "best",
  "leading",
  "trusted",
  "reputable",
  "respected",
  "experienced",
  "successful",
  "renowned",
  "highly rated",
  "well known",
  "well-known",
  "outstanding",
  "excellent",
  "strong track record",
  "results",
  "skilled",
  "premier",
  "preeminent",
];

const NEGATIVE_TOKENS = [
  "avoid",
  "complaints",
  "lawsuit against",
  "sanctioned",
  "disbarred",
  "negative reviews",
  "controversial",
  "scam",
  "warning",
  "do not recommend",
  "poor reviews",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFirstIndex(haystack: string, needles: string[]): number {
  let best = -1;
  for (const n of needles) {
    if (!n) continue;
    const idx = haystack.toLowerCase().indexOf(n.toLowerCase());
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function countOccurrences(haystack: string, needles: string[]): number {
  let total = 0;
  const lc = haystack.toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    const re = new RegExp(`\\b${escapeRegex(n.toLowerCase())}\\b`, "g");
    total += (lc.match(re) ?? []).length;
  }
  return total;
}

function nearestSentence(text: string, index: number): string {
  if (index < 0) return "";
  const start = Math.max(
    text.lastIndexOf(".", index),
    text.lastIndexOf("!", index),
    text.lastIndexOf("?", index),
    text.lastIndexOf("\n", index),
    -1,
  );
  let end = -1;
  for (const ch of [".", "!", "?", "\n"]) {
    const i = text.indexOf(ch, index);
    if (i >= 0 && (end === -1 || i < end)) end = i;
  }
  if (end === -1) end = text.length;
  return text.slice(start + 1, end + 1).trim();
}

function classifySentiment(snippet: string): AEOBrandMention["sentiment"] {
  if (!snippet) return null;
  const lc = snippet.toLowerCase();
  const pos = POSITIVE_TOKENS.some((t) => lc.includes(t));
  const neg = NEGATIVE_TOKENS.some((t) => lc.includes(t));
  if (pos && neg) return "mixed";
  if (pos) return "positive";
  if (neg) return "negative";
  return "neutral";
}

export function analyzeResponse(args: {
  text: string;
  citations: AEOCitation[];
  targets: AEOTarget[];
}): AEOAnalysisResult {
  const { text, citations, targets } = args;

  // Locate every target's first mention so we can build an ordinal ranking.
  const located = targets
    .map((t) => {
      const aliases = [t.name, ...(t.aliases ?? [])].filter(Boolean);
      const idx = findFirstIndex(text, aliases);
      const occurrences = countOccurrences(text, aliases);
      return { target: t, idx, occurrences };
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const brandMentions: AEOBrandMention[] = located.map((x, i) => {
    const sentence = nearestSentence(text, x.idx);
    return {
      target_id: x.target.id,
      name: x.target.name,
      type: x.target.type,
      position: i + 1,
      occurrences: x.occurrences,
      sentiment: classifySentiment(sentence),
    };
  });

  const selfMention = brandMentions.find((b) => b.type === "self") ?? null;

  const authoritySources = Array.from(
    new Set(
      citations
        .map((c) => c.domain)
        .filter((d) => AUTHORITY_DOMAINS.has(d)),
    ),
  );

  return {
    brandMentions,
    selfMentioned: !!selfMention,
    selfPosition: selfMention?.position ?? null,
    selfSentiment: selfMention?.sentiment ?? null,
    authoritySources,
  };
}

/** Provided for the UI's authority-source filter chips. */
export const KNOWN_AUTHORITY_DOMAINS = Array.from(AUTHORITY_DOMAINS).sort();
