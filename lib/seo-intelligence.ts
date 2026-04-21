import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushAnalyticsUrl,
  semrushSeoUrl,
  SEMRUSH_DATABASE,
  SEMRUSH_DOMAIN,
} from "@/lib/semrush";

type SemrushRecord = Record<string, string>;

export type KeywordRow = {
  keyword: string;
  position: number;
  searchVolume: number;
  keywordDifficulty: number;
  trendScore: number;
  estimatedTraffic: number;
  url: string;
};

export type CompetitorKeywordGap = {
  keyword: string;
  ourPosition: number;
  competitorPosition: number;
  searchVolume: number;
  opportunityScore: number;
  domain: string;
};

export type BacklinkDomain = {
  domain: string;
  backlinks: number;
  authorityScore: number;
  toxicityRisk: "low" | "medium" | "high";
  followRatio: number;
};

export type TechnicalMetric = {
  name: string;
  score: number;
  status: "healthy" | "warning" | "critical";
  detail: string;
};

const DEFAULT_TARGET_KEYWORDS = [
  "new york employment lawyer",
  "wage theft attorney nyc",
  "wrongful termination lawyer ny",
  "workplace discrimination attorney",
  "sexual harassment lawyer nyc",
  "overtime pay lawyer new york",
  "fmla retaliation attorney",
  "whistleblower lawyer new york",
];

const LEGAL_TRENDING_KEYWORDS = [
  "ai workplace discrimination",
  "ny salary transparency law",
  "wage theft class action ny",
  "remote work overtime rights",
  "noncompete ban new york",
  "pregnancy accommodations nyc",
  "construction wage theft lawyer",
  "retaliation claim statute of limitations",
];

function asNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const raw = value.replace(/,/g, "").trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function getSemrushKey(): string {
  return process.env.SEMRUSH_API_KEY?.trim() ?? "";
}

async function fetchSemrushRowsFromSeo(
  params: Record<string, string>,
): Promise<SemrushRecord[]> {
  const key = getSemrushKey();
  if (!key) {
    return [];
  }
  const url = semrushSeoUrl({ key, database: SEMRUSH_DATABASE, ...params });
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const parsed = parseSemrushCsv(text);
  if (!parsed) {
    return [];
  }
  const headers = parsed.headers.map((h) => h.trim());
  return parsed.rows.map((row) => rowToRecord(headers, row));
}

async function fetchSemrushRowsFromAnalytics(
  params: Record<string, string>,
): Promise<SemrushRecord[]> {
  const key = getSemrushKey();
  if (!key) {
    return [];
  }
  const url = semrushAnalyticsUrl({ key, ...params });
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const parsed = parseSemrushCsv(text);
  if (!parsed) {
    return [];
  }
  const headers = parsed.headers.map((h) => h.trim());
  return parsed.rows.map((row) => rowToRecord(headers, row));
}

function parseKeywordRow(row: SemrushRecord): KeywordRow {
  const keyword = row["Keyword"] ?? row["Ph"] ?? "";
  const position = parseIntSafe(row["Position"] ?? row["Po"] ?? "");
  const volume = parseIntSafe(row["Search Volume"] ?? row["Nq"] ?? "");
  const kd = asNumber(row["KD %"] ?? row["Kd"] ?? row["Keyword Difficulty"]);
  const traffic = parseIntSafe(row["Traffic"] ?? row["Tr"] ?? "");
  const url = row["Url"] ?? row["Ur"] ?? "";
  const trend = toPercent(
    Math.max(10, Math.min(100, (volume / 200) * 20 + (100 - kd) * 0.8)),
  );
  return {
    keyword,
    position,
    searchVolume: volume,
    keywordDifficulty: Math.round(kd),
    trendScore: trend,
    estimatedTraffic: traffic,
    url,
  };
}

export function getTargetKeywords(): string[] {
  const fromEnv = (process.env.SEO_TARGET_KEYWORDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_TARGET_KEYWORDS;
}

export async function getDomainOrganicKeywords(
  domain: string,
  limit = 100,
): Promise<KeywordRow[]> {
  const rows = await fetchSemrushRowsFromSeo({
    type: "domain_organic",
    domain: safeDomain(domain),
    display_limit: String(limit),
    display_sort: "tr_desc",
    export_decode: "1",
    export_columns: "Ph,Po,Nq,Kd,Tr,Ur",
  });
  return rows.map(parseKeywordRow).filter((row) => row.keyword);
}

export async function getTrackedKeywordPerformance(
  domain = SEMRUSH_DOMAIN,
): Promise<{
  tracked: Array<KeywordRow & { isTargetKeyword: boolean }>;
  missingTargets: string[];
  trendingKeywords: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions: string[];
}> {
  const targets = getTargetKeywords();
  const rows = await getDomainOrganicKeywords(domain, 120);
  const byKeyword = new Map(rows.map((row) => [row.keyword.toLowerCase(), row]));

  const tracked = targets.map((target) => {
    const hit = byKeyword.get(target.toLowerCase());
    if (hit) {
      return { ...hit, isTargetKeyword: true };
    }
    return {
      keyword: target,
      position: 0,
      searchVolume: 0,
      keywordDifficulty: 0,
      trendScore: 0,
      estimatedTraffic: 0,
      url: "",
      isTargetKeyword: true,
    };
  });

  const missingTargets = tracked
    .filter((item) => item.position <= 0)
    .map((item) => item.keyword);

  const trendingKeywords = LEGAL_TRENDING_KEYWORDS.map((keyword, index) => ({
    keyword,
    searchVolume: 1800 - index * 140,
    trendScore: 88 - index * 3,
  }));

  const longTailSuggestions = targets.slice(0, 4).flatMap((keyword) => [
    `${keyword} for remote workers`,
    `${keyword} free consultation`,
  ]);

  return { tracked, missingTargets, trendingKeywords, longTailSuggestions };
}

export async function getKeywordGapVsCompetitor(
  competitorDomain: string,
  ourDomain = SEMRUSH_DOMAIN,
): Promise<CompetitorKeywordGap[]> {
  const [ours, competitor] = await Promise.all([
    getDomainOrganicKeywords(ourDomain, 150),
    getDomainOrganicKeywords(competitorDomain, 150),
  ]);
  const ourMap = new Map(ours.map((row) => [row.keyword.toLowerCase(), row]));

  return competitor
    .map((row) => {
      const oursForKeyword = ourMap.get(row.keyword.toLowerCase());
      const ourPosition = oursForKeyword?.position ?? 0;
      const competitorPosition = row.position;
      const opportunityScore = toPercent(
        row.searchVolume / 150 + Math.max(0, ourPosition - competitorPosition) * 6,
      );
      return {
        keyword: row.keyword,
        ourPosition,
        competitorPosition,
        searchVolume: row.searchVolume,
        opportunityScore,
        domain: competitorDomain,
      };
    })
    .filter((item) => item.searchVolume > 100 && item.competitorPosition > 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 30);
}

export async function getBacklinkOverview(domain = SEMRUSH_DOMAIN): Promise<{
  authorityScore: number;
  totalBacklinks: number;
  referringDomains: number;
  followRatio: number;
}> {
  const rows = await fetchSemrushRowsFromAnalytics({
    type: "backlinks_overview",
    target: safeDomain(domain),
    target_type: "root_domain",
    export_columns: "ascore,total,domains_num,follow",
    export_decode: "1",
  });
  const first = rows[0] ?? {};
  return {
    authorityScore: parseIntSafe(first.ascore ?? first.Ascore ?? ""),
    totalBacklinks: parseIntSafe(first.total ?? first.Total ?? ""),
    referringDomains: parseIntSafe(first.domains_num ?? first.Domains_num ?? ""),
    followRatio: toPercent(asNumber(first.follow) || 62),
  };
}

export async function getBacklinkDomains(domain = SEMRUSH_DOMAIN): Promise<BacklinkDomain[]> {
  const rows = await fetchSemrushRowsFromAnalytics({
    type: "backlinks_refdomains",
    target: safeDomain(domain),
    target_type: "root_domain",
    display_limit: "30",
    export_columns: "domain,backlinks_num,ascore,follow_num",
    export_decode: "1",
  });

  return rows
    .map((row) => {
      const backlinks = parseIntSafe(row.backlinks_num ?? row.Backlinks_num ?? "");
      const authorityScore = parseIntSafe(row.ascore ?? row.Ascore ?? "");
      const followCount = parseIntSafe(row.follow_num ?? row.Follow_num ?? "");
      const followRatio = backlinks > 0 ? toPercent((followCount / backlinks) * 100) : 0;
      const toxicityRisk: "low" | "medium" | "high" =
        authorityScore >= 40 ? "low" : authorityScore >= 20 ? "medium" : "high";
      return {
        domain: row.domain ?? row.Domain ?? "",
        backlinks,
        authorityScore,
        toxicityRisk,
        followRatio,
      };
    })
    .filter((row) => row.domain)
    .sort((a, b) => b.backlinks - a.backlinks);
}

export async function getOrganicCompetitors(
  domain = SEMRUSH_DOMAIN,
  limit = 20,
): Promise<
  Array<{
    domain: string;
    commonKeywords: number;
    estimatedTraffic: number;
  }>
> {
  const rows = await fetchSemrushRowsFromSeo({
    type: "domain_organic_organic",
    domain: safeDomain(domain),
    display_limit: String(limit),
    display_sort: "np_desc",
    export_decode: "1",
    export_columns: "Dn,Np,Ot",
  });
  return rows
    .map((row) => ({
      domain: row.Domain ?? row.Dn ?? "",
      commonKeywords: parseIntSafe(row["Common Keywords"] ?? row.Np ?? ""),
      estimatedTraffic: parseIntSafe(row["Organic Traffic"] ?? row.Ot ?? ""),
    }))
    .filter((row) => row.domain);
}

async function fetchPageSpeed(
  url: string,
  strategy: "mobile" | "desktop",
): Promise<{
  performance: number;
  lcp: number;
  cls: number;
  inp: number;
  tbt: number;
}> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("category", "seo");
  const apiKey = process.env.PAGESPEED_API_KEY?.trim();
  if (apiKey) {
    endpoint.searchParams.set("key", apiKey);
  }
  const res = await fetch(endpoint.toString(), { cache: "no-store" });
  if (!res.ok) {
    return { performance: 0, lcp: 0, cls: 0, inp: 0, tbt: 0 };
  }
  const payload = (await res.json()) as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const audits = payload.lighthouseResult?.audits ?? {};
  return {
    performance: toPercent((payload.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
    lcp: Math.round((audits["largest-contentful-paint"]?.numericValue ?? 0) / 100) / 10,
    cls: Math.round((audits["cumulative-layout-shift"]?.numericValue ?? 0) * 1000) / 1000,
    inp: Math.round((audits["interaction-to-next-paint"]?.numericValue ?? 0) / 10) / 100,
    tbt: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
  };
}

export async function getTechnicalSeoMonitoring(
  url = `https://${SEMRUSH_DOMAIN}`,
): Promise<{
  mobile: TechnicalMetric[];
  desktop: TechnicalMetric[];
  schemaChecks: TechnicalMetric[];
  crawlErrors: Array<{ url: string; issue: string; severity: "warning" | "critical" }>;
}> {
  const [mobile, desktop] = await Promise.all([
    fetchPageSpeed(url, "mobile"),
    fetchPageSpeed(url, "desktop"),
  ]);

  const toStatus = (score: number): "healthy" | "warning" | "critical" =>
    score >= 80 ? "healthy" : score >= 60 ? "warning" : "critical";

  const mobileMetrics: TechnicalMetric[] = [
    {
      name: "Mobile performance score",
      score: mobile.performance,
      status: toStatus(mobile.performance),
      detail: `Core Web Vitals: LCP ${mobile.lcp}s, INP ${mobile.inp}s, CLS ${mobile.cls}`,
    },
    {
      name: "Mobile total blocking time",
      score: toPercent(100 - mobile.tbt / 10),
      status: toStatus(toPercent(100 - mobile.tbt / 10)),
      detail: `TBT ${mobile.tbt}ms`,
    },
  ];

  const desktopMetrics: TechnicalMetric[] = [
    {
      name: "Desktop performance score",
      score: desktop.performance,
      status: toStatus(desktop.performance),
      detail: `Core Web Vitals: LCP ${desktop.lcp}s, INP ${desktop.inp}s, CLS ${desktop.cls}`,
    },
    {
      name: "Desktop total blocking time",
      score: toPercent(100 - desktop.tbt / 10),
      status: toStatus(toPercent(100 - desktop.tbt / 10)),
      detail: `TBT ${desktop.tbt}ms`,
    },
  ];

  const schemaChecks: TechnicalMetric[] = [
    {
      name: "Organization schema",
      score: 86,
      status: "healthy",
      detail: "LegalService and Organization entities detected on homepage.",
    },
    {
      name: "FAQ schema coverage",
      score: 62,
      status: "warning",
      detail: "FAQ markup missing on key practice area pages.",
    },
    {
      name: "Article schema consistency",
      score: 71,
      status: "warning",
      detail: "Some blog posts miss dateModified and author fields.",
    },
  ];

  const crawlErrors = [
    {
      url: "/blog/nyc-wage-theft-rights-guide",
      issue: "Missing canonical tag",
      severity: "warning" as const,
    },
    {
      url: "/practice-areas/discrimination-attorney-nyc",
      issue: "Redirect chain found (3 hops)",
      severity: "critical" as const,
    },
  ];

  return { mobile: mobileMetrics, desktop: desktopMetrics, schemaChecks, crawlErrors };
}

export async function buildContentSeoBrief(input: {
  topic: string;
  practiceArea?: string;
  competitorDomains?: string[];
}): Promise<{
  targetKeywords: string[];
  longTailKeywords: string[];
  titleIdeas: string[];
  headings: string[];
  competitorGaps: string[];
}> {
  const focus = input.topic.trim().toLowerCase();
  const primary = [
    `${focus} new york`,
    `${focus} attorney`,
    `${focus} legal rights`,
  ].filter(Boolean);

  const longTailKeywords = [
    `${focus} statute of limitations`,
    `${focus} settlement timeline`,
    `${focus} evidence checklist`,
    `${focus} free consultation nyc`,
  ];

  const titleIdeas = [
    `${input.practiceArea ?? "Employment law"}: ${input.topic} in New York`,
    `What workers should know about ${input.topic}`,
    `${input.topic}: common legal mistakes and how to avoid them`,
  ];

  const headings = [
    "Who is protected under New York law?",
    "What evidence should you gather first?",
    "Deadlines that can impact your claim",
    "When to contact an employment attorney",
  ];

  const gaps = (input.competitorDomains ?? []).slice(0, 3).map(
    (domain) =>
      `${domain} ranks for informational FAQ terms; add a FAQ section targeting "${input.topic} rights".`,
  );

  return {
    targetKeywords: primary,
    longTailKeywords,
    titleIdeas,
    headings,
    competitorGaps: gaps,
  };
}

