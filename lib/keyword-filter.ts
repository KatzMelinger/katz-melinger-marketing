/**
 * Keyword relevance / junk filter — the missing piece that turns the SEO
 * Opportunity list into a system.
 *
 * The Opportunity Radar surfaces raw SEMrush gaps, which include navigational
 * junk ("unemployment login", "nys dol phone number"), the firm's own brand
 * terms, and competitor brand terms — all sitting next to real practice-area
 * opportunities. `scoreKeyword` assigns a 0-100 relevance score and an
 * `excluded` flag with a human reason, so the Radar can hide noise by default
 * while still letting the user reveal it.
 *
 * Pure + synchronous so it can run in the sync job and in tests. The caller
 * (the sync route) precomputes the brand/competitor tokens once and passes them
 * in via `FilterContext`.
 */

import { classifyKeywordCluster } from "@/lib/keyword-cluster";

export type KeywordQuality = {
  /** 0-100; higher = more worth writing for. */
  relevanceScore: number;
  /** True → hidden from the default Radar list. */
  excluded: boolean;
  /** Short human reason when excluded (e.g. "Navigational / account query"). */
  excludeReason?: string;
  /** Machine-readable tags for the UI (e.g. ["navigational"], ["branded"]). */
  flags: string[];
};

export type FilterMetrics = {
  searchVolume?: number | null;
  keywordDifficulty?: number | null;
};

export type FilterContext = {
  /** Lower-cased brand phrases for the firm itself (always excluded). */
  brandTokens: string[];
  /** Lower-cased competitor brand tokens (excluded). */
  competitorTokens: string[];
  /**
   * Diana-managed exclusion terms (normalized, lower-cased). A keyword
   * containing any of these is excluded. Curated in the Opportunities UI and
   * stored in seo_keyword_exclusions — the editable layer over the built-ins.
   */
  customExclusions?: string[];
};

/**
 * The firm's own brand + principal-name phrases — keywords containing these are
 * navigational ("find this firm/person"), never content opportunities.
 */
export const KM_BRAND_TOKENS = [
  "katz melinger",
  "katzmelinger",
  "katz & melinger",
  "katz and melinger",
  "ken katz",
  "kenneth katz",
  "kenneth j katz",
];

/**
 * Navigational / transactional-account / government-portal patterns. These are
 * people trying to reach a login or a phone number, not readers looking for
 * legal information — never worth a content page.
 */
const NAVIGATIONAL_PATTERNS: RegExp[] = [
  /\blog\s?in\b/,
  /\bsign\s?in\b/,
  /\bportal\b/,
  /\bdashboard\b/,
  /\bpassword\b/,
  /\bmy ?account\b/,
  /\bclaim status\b/,
  /\bcheck.*(status|balance)\b/,
  /\bphone number\b/,
  /\bcustomer service\b/,
  /\bcontact number\b/,
  /\bnear me hours\b/,
  /\bunemployment\b.*\b(login|portal|claim|benefits?|weekly)\b/,
  /\bnys?\s?dol\b/,
  /\bdepartment of labor\b.*\b(login|portal|number|hours)\b/,
];

/**
 * Off-domain topics. These are real searches, but for subjects the firm does
 * not practice — unemployment insurance / benefits and tax-form questions are
 * not employment-litigation content. Excluding them keeps irrelevant keywords
 * (e.g. "1099 NYS unemployment", "file for unemployment") out of Opportunities.
 */
const OFF_DOMAIN_PATTERNS: RegExp[] = [
  /\bunemployment\b/,
  /\b1099\b/,
  /\bw-?2\b/,
];

function normalize(keyword: string): string {
  return ` ${keyword.toLowerCase().trim()} `;
}

/**
 * Derive lower-cased brand tokens from a competitor domain. We only get domains
 * (e.g. "outtengolden.com"), so we take the bare label as one token — enough to
 * catch keywords that literally name the competitor.
 */
export function competitorTokensFromDomains(domains: string[]): string[] {
  return domains
    .map((d) =>
      d
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\.[a-z.]+$/i, "")
        .trim(),
    )
    .filter((t) => t.length >= 4);
}

export function scoreKeyword(
  keyword: string,
  metrics: FilterMetrics,
  ctx: FilterContext,
): KeywordQuality {
  const lc = normalize(keyword);
  const flags: string[] = [];

  // --- Hard exclusions (blocklist) ---------------------------------------
  if (ctx.brandTokens.some((t) => lc.includes(t))) {
    return { relevanceScore: 0, excluded: true, excludeReason: "Branded (firm name)", flags: ["branded"] };
  }
  if (ctx.competitorTokens.some((t) => lc.includes(` ${t} `) || lc.includes(`${t} `) || lc.includes(` ${t}`))) {
    return { relevanceScore: 0, excluded: true, excludeReason: "Competitor brand term", flags: ["competitor_brand"] };
  }
  if (NAVIGATIONAL_PATTERNS.some((re) => re.test(lc))) {
    return { relevanceScore: 0, excluded: true, excludeReason: "Navigational / account query", flags: ["navigational"] };
  }
  if (OFF_DOMAIN_PATTERNS.some((re) => re.test(lc))) {
    return { relevanceScore: 0, excluded: true, excludeReason: "Off-domain (unemployment / tax)", flags: ["off_domain"] };
  }
  if (ctx.customExclusions?.length) {
    const hit = ctx.customExclusions.find((t) => t && lc.includes(t));
    if (hit) {
      return { relevanceScore: 0, excluded: true, excludeReason: `Custom: ${hit}`, flags: ["custom_exclusion"] };
    }
  }

  // --- Relevance scoring --------------------------------------------------
  let score = 50;
  const cluster = classifyKeywordCluster(keyword);
  if (cluster.key !== "other" && cluster.key !== "general") {
    score += 30; // maps to a specific practice area
    flags.push(`cluster:${cluster.key}`);
  } else if (cluster.key === "general") {
    score += 10; // generic "employment lawyer" intent — useful but broad
    flags.push("cluster:general");
  } else {
    score -= 25; // no practice-area signal
    flags.push("offtopic");
  }

  const volume = metrics.searchVolume ?? 0;
  if (volume >= 1000) score += 20;
  else if (volume >= 200) score += 12;
  else if (volume >= 50) score += 5;
  else score -= 10; // very low demand

  const kd = metrics.keywordDifficulty;
  if (typeof kd === "number") {
    if (kd <= 30) score += 8;
    else if (kd >= 70) score -= 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // We do NOT exclude on a cluster-miss. The cluster classifier is English-only
  // and intentionally narrow, so excluding off-topic-looking terms wrongly hides
  // real opportunities (Spanish keywords like "abogado de despido injustificado",
  // "at will employment state", "ADA ADHD", …). Only the hard blocklist above
  // (navigational / branded / competitor) excludes; everything else stays and is
  // simply ranked by relevance so weak terms sort to the bottom.
  return { relevanceScore: score, excluded: false, flags };
}
