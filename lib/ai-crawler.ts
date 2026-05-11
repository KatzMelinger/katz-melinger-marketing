/**
 * AI search readiness crawler.
 *
 * Strategic-sample crawler: picks the homepage, the top traffic-driving pages
 * from Search Console, and the most "service-like" pages from the sitemap.
 * For each page we pull structured data, content shape, and AI-bot robots.txt
 * rules. The raw signals are scored by Claude in the analyze route.
 *
 * Capped at 10 URLs per run to stay inside the route's 300s budget.
 */

import { getGoogleAccessToken } from "@/lib/google-access-token";
import { gscSiteUrlEncoded } from "@/lib/gsc-site-url";
import { logger } from "@/lib/logger";

const MAX_CRAWL_PAGES = 10;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface AICrawlerBot {
  name: string;
  userAgent: string;
  company: string;
}

export const AI_BOTS: AICrawlerBot[] = [
  { name: "GPTBot", userAgent: "GPTBot", company: "OpenAI (ChatGPT)" },
  { name: "ChatGPT-User", userAgent: "ChatGPT-User", company: "OpenAI (ChatGPT Browse)" },
  { name: "Google-Extended", userAgent: "Google-Extended", company: "Google (Gemini/Bard)" },
  { name: "Googlebot", userAgent: "Googlebot", company: "Google (Search/AI Overviews)" },
  { name: "ClaudeBot", userAgent: "ClaudeBot", company: "Anthropic (Claude)" },
  { name: "anthropic-ai", userAgent: "anthropic-ai", company: "Anthropic (Claude)" },
  { name: "Bytespider", userAgent: "Bytespider", company: "ByteDance" },
  { name: "CCBot", userAgent: "CCBot", company: "Common Crawl (training data)" },
  { name: "cohere-ai", userAgent: "cohere-ai", company: "Cohere" },
  { name: "PerplexityBot", userAgent: "PerplexityBot", company: "Perplexity AI" },
  { name: "Applebot-Extended", userAgent: "Applebot-Extended", company: "Apple (Siri/AI)" },
  { name: "Meta-ExternalAgent", userAgent: "Meta-ExternalAgent", company: "Meta AI" },
];

export interface RobotsTxtResult {
  exists: boolean;
  content: string;
  botAccess: { bot: string; company: string; allowed: boolean; rules: string[] }[];
  hasSitemap: boolean;
  sitemapUrls: string[];
}

export interface SchemaMarkupDetail {
  type: string;
  properties: string[];
  raw: unknown;
}

export interface AIReadinessPageData {
  url: string;
  title: string;
  metaDescription: string;
  h1Tags: string[];
  h2Tags: string[];
  h3Tags: string[];
  wordCount: number;
  hasCanonical: boolean;
  canonicalUrl: string;

  schemaMarkup: SchemaMarkupDetail[];
  hasFAQSchema: boolean;
  hasHowToSchema: boolean;
  hasLegalServiceSchema: boolean;
  hasAttorneySchema: boolean;
  hasLocalBusinessSchema: boolean;
  hasOrganizationSchema: boolean;
  hasBreadcrumbSchema: boolean;
  hasArticleSchema: boolean;

  hasAuthorInfo: boolean;
  authorName: string;
  hasPublishDate: boolean;
  publishDate: string;
  hasModifiedDate: boolean;
  modifiedDate: string;

  hasFAQContent: boolean;
  faqCount: number;
  hasListContent: boolean;
  listCount: number;
  hasTableContent: boolean;
  tableCount: number;

  hasOpenGraph: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  hasTwitterCard: boolean;

  citationSignals: {
    hasStatistics: boolean;
    hasQuotes: boolean;
    hasSourceLinks: boolean;
    hasDefinitions: boolean;
  };

  contentClarity: {
    avgSentenceLength: number;
    hasShortParagraphs: boolean;
    usesBulletPoints: boolean;
    hasNumberedLists: boolean;
  };

  internalLinks: number;
  externalLinks: number;
  imageCount: number;
  imagesWithAlt: number;
  imagesWithoutAlt: number;
}

export interface AISiteCrawlResult {
  domain: string;
  baseUrl: string;
  crawledAt: string;
  robotsTxt: RobotsTxtResult;
  pages: AIReadinessPageData[];
  siteWideSummary: {
    totalPages: number;
    avgWordCount: number;
    totalSchemaTypes: string[];
    pagesWithFAQ: number;
    pagesWithAuthor: number;
    pagesWithSchema: number;
    pagesWithOG: number;
  };
}

const USER_AGENT = "KMDashboard-AICrawler/1.0";

function normalizeBaseUrl(input: string): { base: string; host: string } {
  let raw = (input || "").trim();
  if (!raw) raw = "https://www.katzmelinger.com";
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  // Strip path/query/hash — we want the site root.
  return { base: `${u.protocol}//${u.host}`, host: u.host };
}

async function fetchRobotsTxt(baseUrl: string): Promise<RobotsTxtResult> {
  const result: RobotsTxtResult = {
    exists: false,
    content: "",
    botAccess: [],
    hasSitemap: false,
    sitemapUrls: [],
  };

  try {
    const res = await fetch(`${baseUrl}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return result;

    result.exists = true;
    result.content = await res.text();

    const sitemapRegex = /Sitemap:\s*(.+)/gi;
    let m: RegExpExecArray | null;
    while ((m = sitemapRegex.exec(result.content)) !== null) {
      result.sitemapUrls.push(m[1].trim());
      result.hasSitemap = true;
    }

    for (const bot of AI_BOTS) {
      const botEntry = {
        bot: bot.name,
        company: bot.company,
        allowed: true,
        rules: [] as string[],
      };

      const lines = result.content.split("\n");
      let inBotSection = false;
      let inWildcardSection = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith("user-agent:")) {
          const agent = trimmed.substring(11).trim();
          inBotSection = agent === bot.userAgent || agent === bot.name;
          inWildcardSection = agent === "*";
        } else if (inBotSection || (!inBotSection && inWildcardSection)) {
          if (trimmed.toLowerCase().startsWith("disallow:")) {
            const path = trimmed.substring(9).trim();
            if (path === "/" || path === "/*") {
              if (inBotSection) {
                botEntry.allowed = false;
                botEntry.rules.push(`Disallow: ${path}`);
              }
            } else if (path) {
              botEntry.rules.push(`Disallow: ${path}`);
            }
          } else if (trimmed.toLowerCase().startsWith("allow:")) {
            const path = trimmed.substring(6).trim();
            if (path) {
              botEntry.rules.push(`Allow: ${path}`);
            }
          }
        }
      }

      const specificBlock = result.content.match(
        new RegExp(`User-agent:\\s*${bot.userAgent}[\\s\\S]*?(?=User-agent:|$)`, "i"),
      );
      if (specificBlock) {
        if (
          /Disallow:\s*\/\s*$/m.test(specificBlock[0]) ||
          /Disallow:\s*\/\*\s*$/m.test(specificBlock[0])
        ) {
          botEntry.allowed = false;
        }
      }

      result.botAccess.push(botEntry);
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to fetch robots.txt",
    );
  }

  return result;
}

function extractSchemaDetails(html: string): SchemaMarkupDetail[] {
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const schemas: SchemaMarkupDetail[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      for (const item of items) {
        schemas.push({
          type: item["@type"] || "Unknown",
          properties: Object.keys(item).filter((k) => !k.startsWith("@")),
          raw: item,
        });
      }
    } catch {
      schemas.push({ type: "Invalid JSON-LD", properties: [], raw: null });
    }
  }

  return schemas;
}

function extractMetaContent(html: string, attr: string): string {
  const regex = new RegExp(
    `<meta[^>]*(?:name|property)=["']${attr}["'][^>]*content=["']([^"']*?)["']|<meta[^>]*content=["']([^"']*?)["'][^>]*(?:name|property)=["']${attr}["']`,
    "i",
  );
  const m = html.match(regex);
  return m ? (m[1] || m[2] || "") : "";
}

function extractTag(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1].replace(/<[^>]*>/g, "").trim());
  }
  return matches;
}

function countWords(html: string): number {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.split(" ").filter((w) => w.length > 0).length;
}

function getPlainText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countLinks(html: string, host: string): { internal: number; external: number } {
  const regex = /href=["']([^"']+)["']/gi;
  let internal = 0;
  let external = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (href.startsWith("/") || href.includes(host)) {
      internal++;
    } else if (href.startsWith("http")) {
      external++;
    }
  }
  return { internal, external };
}

function countImages(html: string): { total: number; withAlt: number; withoutAlt: number } {
  const regex = /<img[^>]*>/gi;
  let total = 0;
  let withAlt = 0;
  let withoutAlt = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    total++;
    const altMatch = m[0].match(/alt=["']([^"']*?)["']/i);
    if (altMatch && altMatch[1].trim()) {
      withAlt++;
    } else {
      withoutAlt++;
    }
  }
  return { total, withAlt, withoutAlt };
}

async function crawlPageForAI(url: string, host: string): Promise<AIReadinessPageData> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  const metaDescription = extractMetaContent(html, "description");

  const canonicalMatch = html.match(
    /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
  );

  const schemas = extractSchemaDetails(html);
  const schemaTypes = schemas.map((s) => s.type.toLowerCase());

  const authorMatch =
    html.match(/(?:author|byline|written[\s-]by)[^>]*>([^<]+)/i) ||
    html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);

  const publishDateMatch =
    html.match(
      /<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    ) || html.match(/<time[^>]*datetime=["']([^"']+)["']/i);

  const modifiedDateMatch = html.match(
    /<meta[^>]*property=["']article:modified_time["'][^>]*content=["']([^"']+)["']/i,
  );

  const faqSections =
    (html.match(/<(?:details|div|section)[^>]*(?:faq|frequently|question)[^>]*>/gi) || []).length;
  const faqSchemaCount = schemas.filter(
    (s) => s.type === "FAQPage" || s.type === "Question",
  ).length;

  const listCount = (html.match(/<(?:ul|ol)[^>]*>/gi) || []).length;
  const tableCount = (html.match(/<table[^>]*>/gi) || []).length;

  const ogTitle = extractMetaContent(html, "og:title");
  const ogDescription = extractMetaContent(html, "og:description");
  const ogImage = extractMetaContent(html, "og:image");
  const twitterCard = extractMetaContent(html, "twitter:card");

  const plainText = getPlainText(html);
  const sentences = plainText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLength =
    sentences.length > 0
      ? Math.round(
          sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length,
        )
      : 0;

  const paragraphs = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const shortParagraphs = paragraphs.filter((p) => {
    const text = p.replace(/<[^>]*>/g, "").trim();
    return text.split(/\s+/).length <= 50;
  });

  const hasStats = /\d+%|\$[\d,]+|\d+\s*(?:million|billion|thousand)|statistic/i.test(plainText);
  const hasQuotes = /<blockquote/i.test(html) || /[""“”]/.test(plainText);
  const hostEscaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasSourceLinks = new RegExp(
    `<a[^>]*href=["']https?://(?!.*${hostEscaped})[^"']+["'][^>]*>(?:source|reference|according|study|report)`,
    "i",
  ).test(html);
  const hasDefinitions =
    /<(?:dfn|abbr)/i.test(html) || /\bis defined as\b|\bmeans\b|\brefers to\b/i.test(plainText);

  const links = countLinks(html, host);
  const images = countImages(html);

  return {
    url,
    title,
    metaDescription,
    h1Tags: extractTag(html, "h1"),
    h2Tags: extractTag(html, "h2"),
    h3Tags: extractTag(html, "h3"),
    wordCount: countWords(html),
    hasCanonical: !!canonicalMatch,
    canonicalUrl: canonicalMatch ? canonicalMatch[1] : "",

    schemaMarkup: schemas,
    hasFAQSchema: schemaTypes.includes("faqpage"),
    hasHowToSchema: schemaTypes.includes("howto"),
    hasLegalServiceSchema: schemaTypes.includes("legalservice"),
    hasAttorneySchema: schemaTypes.includes("attorney"),
    hasLocalBusinessSchema:
      schemaTypes.includes("localbusiness") ||
      schemaTypes.includes("attorney") ||
      schemaTypes.includes("legalservice"),
    hasOrganizationSchema: schemaTypes.includes("organization"),
    hasBreadcrumbSchema: schemaTypes.includes("breadcrumblist"),
    hasArticleSchema:
      schemaTypes.includes("article") ||
      schemaTypes.includes("blogposting") ||
      schemaTypes.includes("newsarticle"),

    hasAuthorInfo: !!authorMatch,
    authorName: authorMatch ? authorMatch[1].trim() : "",
    hasPublishDate: !!publishDateMatch,
    publishDate: publishDateMatch ? publishDateMatch[1] : "",
    hasModifiedDate: !!modifiedDateMatch,
    modifiedDate: modifiedDateMatch ? modifiedDateMatch[1] : "",

    hasFAQContent: faqSections > 0 || faqSchemaCount > 0,
    faqCount: Math.max(faqSections, faqSchemaCount),
    hasListContent: listCount > 0,
    listCount,
    hasTableContent: tableCount > 0,
    tableCount,

    hasOpenGraph: !!(ogTitle || ogDescription || ogImage),
    ogTitle,
    ogDescription,
    ogImage,
    hasTwitterCard: !!twitterCard,

    citationSignals: {
      hasStatistics: hasStats,
      hasQuotes,
      hasSourceLinks,
      hasDefinitions,
    },

    contentClarity: {
      avgSentenceLength,
      hasShortParagraphs: shortParagraphs.length > paragraphs.length * 0.5,
      usesBulletPoints: listCount > 0,
      hasNumberedLists: (html.match(/<ol[^>]*>/gi) || []).length > 0,
    },

    internalLinks: links.internal,
    externalLinks: links.external,
    imageCount: images.total,
    imagesWithAlt: images.withAlt,
    imagesWithoutAlt: images.withoutAlt,
  };
}

async function fetchSitemapUrls(base: string, host: string): Promise<string[]> {
  const urls: string[] = [];
  try {
    const res = await fetch(`${base}/sitemap.xml`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return urls;
    const xml = await res.text();
    const urlRegex = /<loc>(.*?)<\/loc>/g;
    let m: RegExpExecArray | null;
    while ((m = urlRegex.exec(xml)) !== null) {
      const u = m[1].trim();
      if (u && u.includes(host)) urls.push(u);
    }
  } catch {
    logger.warn({ host }, "Sitemap fetch failed");
  }
  return urls;
}

async function fetchTopGscPages(limit: number): Promise<string[]> {
  try {
    const auth = await getGoogleAccessToken([GSC_SCOPE]);
    if ("error" in auth) return [];

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 28);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${gscSiteUrlEncoded()}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: ymd(start),
          endDate: ymd(end),
          dimensions: ["page"],
          rowLimit: limit,
          orderBy: [{ field: "clicks", sortOrder: "descending" }],
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { rows?: { keys?: string[] }[] };
    return (json.rows ?? [])
      .map((r) => r.keys?.[0] ?? "")
      .filter((u) => u.startsWith("http"));
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "GSC top pages fetch failed",
    );
    return [];
  }
}

/**
 * Score a sitemap URL by how likely it represents an evergreen service page
 * (the kind AI assistants are most likely to cite). Higher is better.
 *
 *  - Shallow paths beat deep ones.
 *  - Practice-area / service / attorney keywords get a bump.
 *  - Blog/news/archive paths get penalized.
 */
function scoreSitemapUrl(rawUrl: string): number {
  let score = 0;
  let path: string;
  try {
    path = new URL(rawUrl).pathname.toLowerCase().replace(/\/$/, "");
  } catch {
    return -100;
  }
  if (!path || path === "/") return 50; // homepage handled separately, but be safe

  const segments = path.split("/").filter(Boolean);
  score -= segments.length * 5;

  const serviceKeywords = [
    "practice", "service", "attorney", "lawyer", "employment", "discrimination",
    "harassment", "wage", "wrongful", "retaliation", "fmla", "overtime",
    "severance", "contract", "non-compete", "whistleblower",
  ];
  if (serviceKeywords.some((kw) => path.includes(kw))) score += 30;

  const penalty = ["/blog/", "/news/", "/tag/", "/category/", "/author/", "/wp-", "/feed", "/page/"];
  if (penalty.some((p) => path.includes(p))) score -= 40;

  return score;
}

function selectStrategicUrls(
  base: string,
  sitemapUrls: string[],
  gscUrls: string[],
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  const canonical = (u: string) => u.replace(/\/$/, "").toLowerCase();

  const add = (u: string) => {
    const key = canonical(u);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(u);
  };

  add(base);

  for (const u of gscUrls) {
    if (picked.length >= MAX_CRAWL_PAGES) break;
    add(u);
  }

  const ranked = [...sitemapUrls]
    .filter((u) => !seen.has(canonical(u)))
    .map((u) => ({ url: u, score: scoreSitemapUrl(u) }))
    .sort((a, b) => b.score - a.score);

  for (const { url } of ranked) {
    if (picked.length >= MAX_CRAWL_PAGES) break;
    add(url);
  }

  return picked;
}

export async function runAICrawl(input?: string): Promise<AISiteCrawlResult> {
  const { base, host } = normalizeBaseUrl(input || "");

  const [sitemapUrls, gscUrls] = await Promise.all([
    fetchSitemapUrls(base, host),
    fetchTopGscPages(6),
  ]);

  const robotsTxt = await fetchRobotsTxt(base);

  const pagesToCrawl = selectStrategicUrls(base, sitemapUrls, gscUrls);
  const pages: AIReadinessPageData[] = [];

  for (const url of pagesToCrawl) {
    try {
      const pageData = await crawlPageForAI(url, host);
      pages.push(pageData);
    } catch (err) {
      logger.warn(
        { url, error: err instanceof Error ? err.message : String(err) },
        "Failed to crawl page for AI readiness",
      );
    }
  }

  const allSchemaTypes = new Set<string>();
  let totalWords = 0;
  let pagesWithFAQ = 0;
  let pagesWithAuthor = 0;
  let pagesWithSchema = 0;
  let pagesWithOG = 0;

  for (const page of pages) {
    page.schemaMarkup.forEach((s) => allSchemaTypes.add(s.type));
    totalWords += page.wordCount;
    if (page.hasFAQContent || page.hasFAQSchema) pagesWithFAQ++;
    if (page.hasAuthorInfo) pagesWithAuthor++;
    if (page.schemaMarkup.length > 0) pagesWithSchema++;
    if (page.hasOpenGraph) pagesWithOG++;
  }

  return {
    domain: host,
    baseUrl: base,
    crawledAt: new Date().toISOString(),
    robotsTxt,
    pages,
    siteWideSummary: {
      totalPages: pages.length,
      avgWordCount: pages.length > 0 ? Math.round(totalWords / pages.length) : 0,
      totalSchemaTypes: Array.from(allSchemaTypes),
      pagesWithFAQ,
      pagesWithAuthor,
      pagesWithSchema,
      pagesWithOG,
    },
  };
}
