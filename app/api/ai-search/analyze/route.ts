/**
 * POST /api/ai-search/analyze
 *
 * Body: AISiteCrawlResult (the JSON returned by /api/ai-search/crawl)
 *
 * Sends the crawl signals to Claude and returns a scored AI-search-readiness
 * analysis: per-platform scores, category scores, critical issues, quick wins,
 * and content/schema recommendations.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import type { AISiteCrawlResult } from "@/lib/ai-crawler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const crawlData = (await req.json()) as AISiteCrawlResult | null;

    if (!crawlData || !Array.isArray(crawlData.pages)) {
      return NextResponse.json(
        { error: "Crawl data is required (POST the response from /api/ai-search/crawl)" },
        { status: 400 },
      );
    }

    const robotsSummary = crawlData.robotsTxt.botAccess
      .map(
        (b) =>
          `- ${b.bot} (${b.company}): ${b.allowed ? "ALLOWED" : "BLOCKED"}${
            b.rules.length > 0 ? ` [${b.rules.join(", ")}]` : ""
          }`,
      )
      .join("\n");

    const pageSummaries = crawlData.pages
      .slice(0, 8)
      .map(
        (p) => `
Page: ${p.url}
  Title: "${p.title}" (${p.title.length} chars)
  Meta Description: "${p.metaDescription}" (${p.metaDescription.length} chars)
  Word Count: ${p.wordCount}
  H1: ${p.h1Tags.join(" | ") || "NONE"}
  H2 count: ${p.h2Tags.length}
  Schema Types: ${p.schemaMarkup.map((s) => s.type).join(", ") || "NONE"}
  FAQ Schema: ${p.hasFAQSchema ? "Yes" : "No"} | FAQ Content: ${p.hasFAQContent ? `Yes (${p.faqCount})` : "No"}
  LegalService Schema: ${p.hasLegalServiceSchema ? "Yes" : "No"}
  Organization Schema: ${p.hasOrganizationSchema ? "Yes" : "No"}
  Author Info: ${p.hasAuthorInfo ? p.authorName : "NONE"}
  Publish Date: ${p.hasPublishDate ? p.publishDate : "NONE"}
  Open Graph: ${p.hasOpenGraph ? "Yes" : "No"} | Twitter Card: ${p.hasTwitterCard ? "Yes" : "No"}
  Citation Signals: Stats=${p.citationSignals.hasStatistics}, Quotes=${p.citationSignals.hasQuotes}, Sources=${p.citationSignals.hasSourceLinks}, Definitions=${p.citationSignals.hasDefinitions}
  Content: Lists=${p.listCount}, Tables=${p.tableCount}, Avg sentence=${p.contentClarity.avgSentenceLength} words
  Links: Internal=${p.internalLinks}, External=${p.externalLinks}
  Images: ${p.imageCount} total, ${p.imagesWithoutAlt} missing alt text`,
      )
      .join("\n");

    const systemPrompt = `You are an expert in AI Search Engine Optimization (AIO/GEO) — the practice of optimizing websites to be discoverable and citeable by AI systems like ChatGPT, Claude, Gemini, Copilot, Grok, and Perplexity.

You are analyzing ${crawlData.domain}. Evaluate based on:
1. AI crawler access (robots.txt rules for GPTBot, ClaudeBot, Google-Extended, etc.)
2. Structured data / schema markup (LegalService, Attorney, FAQPage, Organization, Article, etc.)
3. Content structure for AI comprehension (clear headings, concise paragraphs, FAQ format)
4. E-E-A-T signals (author attribution, publish dates, credentials, expertise demonstration)
5. Citation-worthiness (statistics, definitions, unique data, authoritative statements)
6. Open Graph / social metadata (how content appears when shared or previewed)
7. Content depth and topical authority
8. Entity clarity (is the business clearly identified as an entity AI models can reference?)`;

    const userPrompt = `Analyze this AI search readiness crawl data for ${crawlData.domain}:

ROBOTS.TXT AI BOT ACCESS:
${robotsSummary}
Sitemap: ${crawlData.robotsTxt.hasSitemap ? crawlData.robotsTxt.sitemapUrls.join(", ") : "NOT FOUND"}

SITE-WIDE SUMMARY:
- Pages crawled: ${crawlData.siteWideSummary.totalPages}
- Average word count: ${crawlData.siteWideSummary.avgWordCount}
- Schema types found: ${crawlData.siteWideSummary.totalSchemaTypes.join(", ") || "NONE"}
- Pages with FAQ: ${crawlData.siteWideSummary.pagesWithFAQ}/${crawlData.siteWideSummary.totalPages}
- Pages with author info: ${crawlData.siteWideSummary.pagesWithAuthor}/${crawlData.siteWideSummary.totalPages}
- Pages with schema: ${crawlData.siteWideSummary.pagesWithSchema}/${crawlData.siteWideSummary.totalPages}
- Pages with OpenGraph: ${crawlData.siteWideSummary.pagesWithOG}/${crawlData.siteWideSummary.totalPages}

PAGE-BY-PAGE DATA:
${pageSummaries}

Provide your analysis in JSON format:

{
  "overallScore": <0-100>,
  "aiPlatformScores": {
    "chatgpt": { "score": <0-100>, "status": "good|fair|poor", "notes": "..." },
    "claude": { "score": <0-100>, "status": "good|fair|poor", "notes": "..." },
    "gemini": { "score": <0-100>, "status": "good|fair|poor", "notes": "..." },
    "copilot": { "score": <0-100>, "status": "good|fair|poor", "notes": "..." },
    "perplexity": { "score": <0-100>, "status": "good|fair|poor", "notes": "..." }
  },
  "categories": {
    "crawlerAccess": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] },
    "structuredData": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] },
    "contentStructure": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] },
    "eeat": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] },
    "citationWorthiness": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] },
    "entityClarity": { "score": <0-100>, "findings": ["..."], "fixes": ["..."] }
  },
  "criticalIssues": [
    { "issue": "...", "impact": "high|medium|low", "fix": "specific fix", "affectedPages": ["URLs"] }
  ],
  "quickWins": ["Specific easy improvements"],
  "contentRecommendations": [
    {
      "type": "new_content|update_existing|add_schema|add_faq",
      "page": "URL or new page suggestion",
      "description": "What to do",
      "aiImpact": "How this improves AI visibility",
      "priority": "high|medium|low"
    }
  ],
  "schemaRecommendations": [
    {
      "schemaType": "e.g. FAQPage, LegalService",
      "where": "Which pages",
      "example": "Brief JSON-LD example snippet",
      "reason": "Why this helps AI discovery"
    }
  ],
  "competitiveInsight": "How this site compares to others in its category"
}`;

    const response = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    let analysis: unknown;
    try {
      analysis = extractJSON(text);
    } catch (err) {
      console.error(
        "[ai-search/analyze] Failed to parse AI response:",
        text.substring(0, 200),
        err,
      );
      return NextResponse.json(
        { error: "AI returned invalid response. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to analyze AI search readiness";
    console.error("[ai-search/analyze] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
