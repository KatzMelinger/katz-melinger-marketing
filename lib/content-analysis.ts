/**
 * Post-generation analysis for a content draft.
 *
 * Computes:
 *   - Readability (Flesch reading ease, normalized 0-100)
 *   - Keyword density
 *   - Target-keyword hits (which SEO-brief keywords actually appear)
 *   - AEO citation-worthiness (heuristic + Claude scoring)
 *   - Brand voice match (Claude compares draft to firm voice settings)
 *
 * Persists the result in `content_analyses` and returns it.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { getFirmContext } from "./firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { checkContentCompliance, type ContentSurface } from "./content-compliance";
import type { ComplianceViolation } from "./compliance-core";
import {
  filterTitlesByCannibalization,
  type FilteredTitle,
} from "./title-cannibalization";

const STOP_WORDS = new Set([
  "the","and","that","with","from","this","your","have","will","about","into",
  "they","their","them","were","been","also","more","than","when","where","what",
  "which","while","would","could","should","other","some","such","does","over",
  "after","before","very","just","only","then","than","like","also","much",
  "many","most","much","each","every","both","either","neither","there","here",
  "those","these","that","whose","whom","who","you","yours","ours","mine",
]);

function countSyllables(word: string): number {
  const lc = word.toLowerCase().replace(/[^a-z]/g, "");
  if (lc.length <= 3) return 1;
  const matches = lc.replace(/(?:[^aeiouy]e[ds]?$|ed$|es$)/g, "").match(/[aeiouy]+/g);
  return matches ? Math.max(1, matches.length) : 1;
}

export type CashBreakdown = {
  conversationalAuthority: number;
  answerCompleteness: number;
  sourceExpertise: number;
  humanAttribution: number;
};

export type SeoBreakdown = {
  titleQuality: number;
  headingStructure: number;
  keywordPlacement: number;
  authorityLinks: number;
  contentDepth: number;
  schemaReadiness: number;
};

export type OutreachAngle = {
  audience: string;
  pitch: string;
};

export type SuggestedImage = {
  type: string;
  description: string;
  altText: string;
};

export type ComplianceStatus = "compliant" | "needs_changes" | "non_compliant";

export type ContentAnalysis = {
  readability_score: number;
  reading_grade_level: number;
  word_count: number;
  sentence_count: number;
  keyword_density: Record<string, number>;
  target_keyword_hits: Record<string, number>;
  aeo_score: number;
  aeo_findings: string[];
  // Scores from Claude-backed calls are nullable so we can distinguish "0
  // because the content scored zero" from "couldn't compute — re-run." The UI
  // renders null as "n/a" with a re-run hint instead of a red 0.
  brand_voice_score: number | null;
  brand_voice_findings: string[];
  cash_score: number | null;
  cash_breakdown: CashBreakdown;
  cash_findings: string[];
  seo_score: number;
  seo_breakdown: SeoBreakdown;
  seo_findings: string[];
  linkability_score: number | null;
  linkability_findings: string[];
  outreach_angles: OutreachAngle[];
  // Attorney-advertising compliance (advisory). Null score = couldn't compute.
  compliance_score: number | null;
  compliance_status: ComplianceStatus | null;
  compliance_violations: ComplianceViolation[];
  compliance_required_disclaimers: string[];
  compliance_summary: string;
  suggested_titles: string[];
  /** Per-title conflict detail (only present in the live response — not
   *  persisted). Lets the UI render a warning badge on titles that overlap
   *  existing site content, even when they survived the filter. */
  suggested_titles_dropped?: FilteredTitle[];
  /** Count of titles excluded because they conflict with existing content.
   *  Surfaced as "N conflicts avoided" in the UI. */
  suggested_titles_conflicts_avoided?: number;
  suggested_images: SuggestedImage[];
  summary: string;
};

function basicMetrics(body: string): {
  words: string[];
  sentences: number;
  syllables: number;
} {
  const text = body.replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1;
  let syllables = 0;
  for (const w of words) syllables += countSyllables(w);
  return { words, sentences, syllables };
}

function fleschReadingEase(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 0;
  return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
}

function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 0;
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

function normalizeReadability(flesch: number): number {
  // Flesch ranges roughly 0 (very hard) to 100 (very easy). Clamp + invert
  // expectation: anything 60-70 is conversational, 30-50 is professional.
  return Math.max(0, Math.min(100, Math.round(flesch)));
}

function keywordDensity(words: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const raw of words) {
    const w = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!w || w.length < 4 || STOP_WORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  // Top 15 by frequency.
  return Object.fromEntries(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15),
  );
}

// Words too generic to carry a keyword's meaning when matching by variant.
const KW_STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "to", "for", "and", "or", "with", "on", "at",
  "is", "it", "your", "you", "how", "what", "are", "ny", "nyc", "near", "me",
]);

// Light stem so derivational variants collapse together:
//   "collection"/"collecting"/"collect" → "collect",
//   "judgments" → "judgment", "enforcing"/"enforced" → "enforc".
function kwStem(w: string): string {
  return w
    .replace(/ies$/, "y")
    .replace(/(ions|ion|ing|ment|ers|er|ed|es|s)$/, "");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the body cover this keyword in a close VARIANT (not the exact phrase)?
 * True when every significant word of the keyword appears as a stem-prefix —
 * so "collecting a judgment in New York" satisfies "judgment collection NY".
 */
function coveredByVariant(lc: string, term: string): boolean {
  const words = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KW_STOPWORDS.has(w));
  if (words.length === 0) return false;
  return words.every((w) => {
    const stem = kwStem(w);
    if (stem.length < 4) return new RegExp(`\\b${escapeRe(w)}\\b`).test(lc);
    return new RegExp(`\\b${escapeRe(stem)}[a-z]*\\b`).test(lc);
  });
}

function targetHits(body: string, targets: string[]): Record<string, number> {
  const lc = body.toLowerCase();
  const out: Record<string, number> = {};
  for (const t of targets) {
    if (!t) continue;
    const re = new RegExp(`\\b${escapeRe(t.toLowerCase())}\\b`, "g");
    const exact = lc.match(re)?.length ?? 0;
    // Exact phrase wins (keeps the over-stuffed signal). If the exact phrase is
    // absent but the concept is covered in a variant, credit it as present (1)
    // rather than flagging it "missing".
    out[t] = exact > 0 ? exact : coveredByVariant(lc, t) ? 1 : 0;
  }
  return out;
}

function heuristicAEO(body: string): { score: number; findings: string[] } {
  const findings: string[] = [];
  let score = 50;

  const hasFAQ = /\bq:\s|\bquestion:|\?\s*\n/i.test(body) || /<faq|^##\s+faq/im.test(body);
  if (hasFAQ) {
    score += 12;
  } else {
    findings.push("No FAQ-style block detected. AI engines reach for explicit Q&A when summarizing.");
  }

  const hasStats = /\d+%|\$[\d,]+|\d+\s*(?:million|billion|thousand)|\d+\s*employees|\d+\s*workers/i.test(body);
  if (hasStats) {
    score += 8;
  } else {
    findings.push("No statistics or specific numbers. AI tends to cite sources that quantify claims.");
  }

  const hasDefinitions = /\bis defined as\b|\bmeans that\b|\brefers to\b|\bin other words\b/i.test(body);
  if (hasDefinitions) {
    score += 6;
  } else {
    findings.push("No explicit definitions. Lines like 'X is defined as…' make extractable answers.");
  }

  const hasLists = /\n\s*[-*]\s+|\n\s*\d+\.\s+/.test(body);
  if (hasLists) {
    score += 6;
  } else {
    findings.push("No bullet or numbered lists. Lists are quoted verbatim by AI more than prose.");
  }

  const hasHeadings = /^#{1,3}\s+/m.test(body);
  if (hasHeadings) {
    score += 6;
  } else {
    findings.push("No markdown headings. Section headers help AI segment your content for citation.");
  }

  const hasCitation = /\bsource:|according to\b|\bstudy\b|\breport\b/i.test(body);
  if (hasCitation) {
    score += 6;
  } else {
    findings.push("No external source references. Citing studies/reports raises citation-worthiness.");
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    score -= 8;
    findings.push(`Only ${wordCount} words — too short to surface as an authoritative answer.`);
  } else if (wordCount > 800) {
    score += 4;
  }

  return { score: Math.max(0, Math.min(100, score)), findings };
}

/**
 * CASH scoring: Conversational Authority + Answer Completeness +
 * Source Expertise + Human Attribution. Maps the Q1 2026 AI Search deck's
 * content QA framework. Distinct from heuristic AEO scoring (which checks
 * for FAQ blocks, lists, stats, etc.) — CASH evaluates voice, expertise,
 * and source credibility from the model's perspective as a reader.
 */
async function cashScore(body: string): Promise<{
  score: number | null;
  breakdown: CashBreakdown;
  findings: string[];
}> {
  const truncated = body.slice(0, 6000);

  const system = `You are evaluating legal content for citation-worthiness by AI answer engines (ChatGPT, Claude, Perplexity, Gemini). You score on the CASH framework:

C - Conversational Authority: Does it read like an expert speaking, not marketing fluff?
A - Answer Completeness: Does it actually answer the question fully, with deadlines, statutes, scenarios?
S - Source Expertise: Are claims grounded — case names, statutes, agency citations, real data?
H - Human Attribution: Is the author identified with credentials? Bio? Real human accountability?

Be strict — most published content scores 40-65. A 70+ should feel genuinely authoritative.`;

  const user = `Draft to score:
"""
${truncated}
"""

Return JSON only:
{
  "conversationalAuthority": <0-100>,
  "answerCompleteness": <0-100>,
  "sourceExpertise": <0-100>,
  "humanAttribution": <0-100>,
  "findings": [
    "[C] <one specific observation about voice>",
    "[A] <one specific observation about completeness>",
    "[S] <one specific observation about sourcing>",
    "[H] <one specific observation about attribution>"
  ]
}

Each finding must start with [C], [A], [S], or [H] to tag which pillar it applies to. 4-8 findings total, only specifics — no vague "could be better" notes.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{
      conversationalAuthority: number;
      answerCompleteness: number;
      sourceExpertise: number;
      humanAttribution: number;
      findings: string[];
    }>(text);
    const c = Math.max(0, Math.min(100, parsed.conversationalAuthority ?? 0));
    const a = Math.max(0, Math.min(100, parsed.answerCompleteness ?? 0));
    const s = Math.max(0, Math.min(100, parsed.sourceExpertise ?? 0));
    const h = Math.max(0, Math.min(100, parsed.humanAttribution ?? 0));
    // Weighted: completeness + sourcing matter most for AI citation.
    const overall = Math.round(c * 0.22 + a * 0.3 + s * 0.3 + h * 0.18);
    return {
      score: overall,
      breakdown: {
        conversationalAuthority: c,
        answerCompleteness: a,
        sourceExpertise: s,
        humanAttribution: h,
      },
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return {
      score: null,
      breakdown: {
        conversationalAuthority: 0,
        answerCompleteness: 0,
        sourceExpertise: 0,
        humanAttribution: 0,
      },
      findings: [
        "CASH scoring couldn't run (Claude call failed). Click Re-run analysis to retry.",
      ],
    };
  }
}

/**
 * Heuristic on-page SEO scoring. Pure string analysis — no external calls.
 * Scores six dimensions and produces actionable findings the user can fix
 * without thinking. Designed for content drafts (markdown), not rendered
 * HTML, so it looks for markdown structure (# headings, [text](url) links)
 * rather than <h1>/<a>.
 */
function heuristicSEO(args: {
  body: string;
  title: string | null;
  format: string | null;
  template: string | null;
  targetKeywords: string[];
}): { score: number; breakdown: SeoBreakdown; findings: string[] } {
  const findings: string[] = [];
  const body = args.body ?? "";
  const lowerBody = body.toLowerCase();
  const lowerTitle = (args.title ?? "").toLowerCase();

  // --- 1. Title quality ----------------------------------------------------
  let titleQuality = 0;
  if (!args.title || args.title.trim().length === 0) {
    findings.push("No title set on the draft. Add a Title field so the page has a clear <title> and H1.");
  } else {
    const len = args.title.trim().length;
    if (len < 30) {
      titleQuality = 50;
      findings.push(`Title is ${len} chars — too short. Aim for 50–60 chars to fill the SERP without truncation.`);
    } else if (len > 65) {
      titleQuality = 60;
      findings.push(`Title is ${len} chars — Google truncates after ~60. Trim it down.`);
    } else if (len >= 50 && len <= 60) {
      titleQuality = 100;
    } else {
      titleQuality = 80;
    }
    // Keyword in title?
    const firstKw = args.targetKeywords[0]?.toLowerCase();
    if (firstKw && !lowerTitle.includes(firstKw)) {
      titleQuality = Math.min(titleQuality, 60);
      findings.push(`Primary target keyword "${args.targetKeywords[0]}" not found in the title.`);
    }
  }

  // --- 2. Heading structure -------------------------------------------------
  const h1Matches = body.match(/^#\s+/gm) ?? [];
  const h2Matches = body.match(/^##\s+/gm) ?? [];
  const h3Matches = body.match(/^###\s+/gm) ?? [];
  let headingStructure = 50;
  if (h1Matches.length === 0) {
    headingStructure -= 20;
    findings.push("No H1 in body (# Heading). The title alone isn't enough — the body should open with a markdown H1.");
  } else if (h1Matches.length > 1) {
    headingStructure -= 10;
    findings.push(`Found ${h1Matches.length} H1 headings. Use exactly one H1 per page.`);
  } else {
    headingStructure += 20;
  }
  if (h2Matches.length >= 3) {
    headingStructure += 25;
  } else if (h2Matches.length > 0) {
    headingStructure += 10;
    findings.push(`Only ${h2Matches.length} H2 sections — pages with 3+ subheads index more sections.`);
  } else {
    findings.push("No H2 subheadings. Break the body into 3–6 H2 sections.");
  }
  if (h3Matches.length > 0) headingStructure += 5;
  headingStructure = Math.max(0, Math.min(100, headingStructure));

  // --- 3. Keyword placement -------------------------------------------------
  let keywordPlacement = 0;
  if (args.targetKeywords.length === 0) {
    keywordPlacement = 50;
    findings.push("No target keywords set on the draft. Add them so this scoring can grade keyword placement.");
  } else {
    const kw = args.targetKeywords[0].toLowerCase();
    const firstParagraph = body.split(/\n\s*\n/)[0]?.toLowerCase() ?? "";
    const firstH1 = h1Matches[0]
      ? (body.match(/^#\s+(.+)$/m)?.[1] ?? "").toLowerCase()
      : "";
    let hits = 0;
    if (lowerTitle.includes(kw)) hits += 1;
    if (firstH1.includes(kw)) hits += 1;
    if (firstParagraph.includes(kw)) hits += 1;
    if (lowerBody.split(kw).length - 1 >= 2) hits += 1;
    keywordPlacement = Math.min(100, hits * 25);
    if (!lowerTitle.includes(kw)) {
      findings.push(`Keyword "${args.targetKeywords[0]}" missing from title.`);
    }
    if (!firstH1.includes(kw) && firstH1) {
      findings.push(`Keyword "${args.targetKeywords[0]}" missing from H1.`);
    }
    if (!firstParagraph.includes(kw)) {
      findings.push(`Keyword "${args.targetKeywords[0]}" missing from the first paragraph.`);
    }
  }

  // --- 4. Authority / outbound links ---------------------------------------
  let authorityLinks = 30;
  const govLinks = (body.match(/\b(?:https?:\/\/)?[^\s)]*\.gov\b/gi) ?? []).length;
  const eduLinks = (body.match(/\b(?:https?:\/\/)?[^\s)]*\.edu\b/gi) ?? []).length;
  const statuteCitations = (body.match(/\b(?:FLSA|NYLL|NJLAD|FMLA|ADA|ADEA|Title VII|29 U\.?S\.?C\.?|42 U\.?S\.?C\.?|§\s*\d+|Section\s+\d+)\b/g) ?? []).length;
  const agencyCitations = (body.match(/\b(?:EEOC|DOL|NLRB|SDHR|NYC ?CHR|NJDOL|NY State Division of Human Rights)\b/g) ?? []).length;
  if (govLinks > 0) authorityLinks += 25;
  if (eduLinks > 0) authorityLinks += 10;
  if (statuteCitations >= 2) authorityLinks += 25;
  else if (statuteCitations === 1) authorityLinks += 12;
  if (agencyCitations >= 1) authorityLinks += 10;
  authorityLinks = Math.max(0, Math.min(100, authorityLinks));
  if (govLinks === 0) {
    findings.push("No .gov links. Linking to dol.gov / eeoc.gov / nyc.gov adds authority + helps reviewers verify claims.");
  }
  if (statuteCitations === 0 && agencyCitations === 0) {
    findings.push("No statute or agency citations (FLSA, NYLL, EEOC, etc.). Legal content without these reads as generic.");
  }

  // --- 5. Content depth ----------------------------------------------------
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  let contentDepth = 50;
  const fmt = args.format ?? "";
  const tpl = args.template ?? "";
  let expectedMin = 500;
  let expectedTarget = 1000;
  if (fmt === "blog") {
    if (tpl === "guide") {
      expectedMin = 1500;
      expectedTarget = 2000;
    } else if (tpl === "webpage") {
      expectedMin = 1000;
      expectedTarget = 1500;
    } else if (tpl === "faq") {
      expectedMin = 800;
      expectedTarget = 1500;
    } else if (tpl === "case_study") {
      expectedMin = 600;
      expectedTarget = 1000;
    } else {
      expectedMin = 800;
      expectedTarget = 1200;
    }
  } else if (fmt === "email") {
    expectedMin = 200;
    expectedTarget = 400;
  } else if (fmt === "podcast") {
    expectedMin = 800;
    expectedTarget = 1500;
  } else if (["linkedin", "twitter", "facebook", "instagram"].includes(fmt)) {
    expectedMin = 100;
    expectedTarget = 300;
  }
  if (wordCount < expectedMin) {
    contentDepth = Math.max(20, Math.round((wordCount / expectedMin) * 60));
    findings.push(
      `${wordCount} words — below the ${expectedMin}+ target for this content type. Search engines reward depth on competitive queries.`,
    );
  } else if (wordCount >= expectedTarget) {
    contentDepth = 100;
  } else {
    contentDepth = 75;
  }

  // --- 6. Schema readiness -------------------------------------------------
  let schemaReadiness = 60;
  let schemaSuggestion = "Article schema";
  if (tpl === "faq" || /\bq:\s|\bquestion:|^##\s+.*\?$/im.test(body)) {
    schemaSuggestion = "FAQPage schema (Q&A pairs map cleanly to FAQPage entries)";
    if (h2Matches.length >= 3) schemaReadiness = 90;
  } else if (tpl === "case_study") {
    schemaSuggestion = "Article + Review schema (case study with outcome qualifies for Review)";
    schemaReadiness = 75;
  } else if (tpl === "webpage") {
    schemaSuggestion = "LegalService + Service schema (service / practice page)";
    schemaReadiness = 70;
  } else if (tpl === "guide") {
    schemaSuggestion = "Article + HowTo schema (long-form guide with steps)";
    schemaReadiness = 80;
  } else if (fmt === "blog") {
    schemaSuggestion = "Article schema (BlogPosting / NewsArticle)";
  }
  findings.push(`Recommended structured data: ${schemaSuggestion}.`);

  const overall = Math.round(
    titleQuality * 0.18 +
      headingStructure * 0.15 +
      keywordPlacement * 0.22 +
      authorityLinks * 0.18 +
      contentDepth * 0.17 +
      schemaReadiness * 0.1,
  );

  return {
    score: Math.max(0, Math.min(100, overall)),
    breakdown: {
      titleQuality: Math.round(titleQuality),
      headingStructure: Math.round(headingStructure),
      keywordPlacement: Math.round(keywordPlacement),
      authorityLinks: Math.round(authorityLinks),
      contentDepth: Math.round(contentDepth),
      schemaReadiness: Math.round(schemaReadiness),
    },
    findings,
  };
}

/**
 * Linkability scoring via Claude. How link-worthy is this piece, and what
 * are the concrete outreach angles? Returns 3–5 specific pitch ideas the
 * marketing team can act on (who would link to this and why).
 */
async function linkabilityScore(args: {
  body: string;
  topic: string;
  title: string | null;
}): Promise<{ score: number | null; findings: string[]; angles: OutreachAngle[] }> {
  const truncated = args.body.slice(0, 6000);
  const titleLine = args.title ? `Title: ${args.title}\n` : "";

  const system = `You are a digital PR + link-building strategist for a plaintiff-side employment law firm. You evaluate a piece of content on how earnable links to it are — both the inherent linkability of the asset and the concrete outreach angles. Be strict. Most marketing content scores 30-55; a 70+ piece has a clear hook a journalist or peer site would actually cite.`;

  const user = `${titleLine}Topic: ${args.topic}

Draft body:
"""
${truncated}
"""

Score the linkability and produce concrete outreach angles. Return JSON only:
{
  "linkability_score": <0-100>,
  "findings": [
    "3-5 specific observations about what makes this linkable or not. Mention what kind of evidence / data / unique angle is present or missing."
  ],
  "outreach_angles": [
    {
      "audience": "Specific outlet type or person — e.g. 'NYC labor reporters', 'HR blogs', 'restaurant industry trade pubs', 'university career services'",
      "pitch": "One-sentence pitch the team could actually send. Lead with the angle, not the content. Must be specific to this piece."
    }
  ]
}

3-5 outreach angles. Each must be specific and actionable — no generic "share on social media" suggestions.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{
      linkability_score: number;
      findings: string[];
      outreach_angles: OutreachAngle[];
    }>(text);
    return {
      score: Math.max(0, Math.min(100, parsed.linkability_score ?? 0)),
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      angles: Array.isArray(parsed.outreach_angles)
        ? parsed.outreach_angles.filter(
            (a): a is OutreachAngle =>
              typeof a?.audience === "string" && typeof a?.pitch === "string",
          )
        : [],
    };
  } catch {
    return {
      score: null,
      findings: [
        "Linkability scoring couldn't run (Claude call failed). Click Re-run analysis to retry.",
      ],
      angles: [],
    };
  }
}

/**
 * Generates SEO-optimized title alternatives (only when no title is set
 * on the draft) and a fresh set of image suggestions (always) the user
 * can hand to a designer or generate via Midjourney/DALL-E.
 *
 * Image suggestions include the type ("hero", "infographic", "supporting
 * photo", "diagram"), a concrete visual description, and ready-to-use
 * alt text for accessibility.
 */
async function contentEnhancements(args: {
  body: string;
  topic: string;
  title: string | null;
  format: string | null;
  template: string | null;
  targetKeywords: string[];
}): Promise<{ titles: string[]; images: SuggestedImage[] }> {
  const truncated = args.body.slice(0, 5000);
  const hasTitle = !!(args.title && args.title.trim().length > 0);

  const formatHint = args.format
    ? `Format: ${args.format}${args.template ? ` (template: ${args.template})` : ""}`
    : "";
  const kwHint = args.targetKeywords.length
    ? `Target keywords: ${args.targetKeywords.join(", ")}`
    : "";

  // Always produce title alternatives. If a title is already set we still
  // want to surface SEO-optimized options — the user picks the one to apply
  // (or sticks with what they have). Pre-existing title is included in the
  // prompt so the model varies the angle rather than parroting it back.
  const existingTitleHint = hasTitle
    ? `Current title (vary angle, do not repeat verbatim): "${args.title}"\n`
    : "";
  const titleSection = `"titles": [
    "5 SEO-optimized title options for this piece. Each 50-60 chars, includes the primary target keyword naturally, written for click-through. Vary the angle (how-to / what-to-know / direct-question / authority-claim / scenario-led). Avoid wording that duplicates the firm's existing titles."
  ]`;

  const system = `You are a content strategist for a plaintiff-side employment law firm. You generate title alternatives and concrete image suggestions for marketing content. Be specific — never generic stock-photo descriptions like "diverse group of professionals." Tie visuals to the legal subject matter, the audience, and what would actually help a worker understand or trust the firm.`;

  const user = `Topic: ${args.topic}
${formatHint}
${kwHint}
${existingTitleHint}
Draft body:
"""
${truncated}
"""

Return JSON only:
{
  ${titleSection},
  "images": [
    {
      "type": "hero | supporting photo | infographic | diagram | data viz | quote card | screenshot mockup",
      "description": "Concrete visual description. What's in the frame, what's the composition. Should be specific enough that a designer or Midjourney prompt could produce it directly.",
      "altText": "Plain-language alt text for the image, focused on what it shows, not decoration."
    }
  ]
}

Produce 4-6 image suggestions covering:
- 1 hero image (top of article)
- 1-2 supporting photos or quote cards (mid-article)
- 1 infographic OR diagram OR data viz (if the content has process steps, deadlines, statistics, or comparisons)
- 0-1 screenshot mockup (if the content references a form, agency website, or document)`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{
      titles?: string[];
      images?: Array<Partial<SuggestedImage>>;
    }>(text);
    const titles = Array.isArray(parsed.titles)
      ? parsed.titles.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];
    const images: SuggestedImage[] = Array.isArray(parsed.images)
      ? parsed.images
          .filter(
            (i): i is SuggestedImage =>
              typeof i?.type === "string" &&
              typeof i?.description === "string" &&
              typeof i?.altText === "string",
          )
          .map((i) => ({
            type: i.type,
            description: i.description,
            altText: i.altText,
          }))
      : [];
    return { titles, images };
  } catch {
    return { titles: [], images: [] };
  }
}

async function brandVoiceMatch(body: string, tenantId?: string): Promise<{ score: number | null; findings: string[]; summary: string }> {
  const firm = await getFirmContext(tenantId);
  const truncated = body.slice(0, 6000); // keep prompt small

  const system = `You are a brand-voice auditor. Score how well a draft matches the firm's voice on a 0-100 scale and list 2-4 specific findings (what fits, what drifts). Be terse.`;
  const user = `Firm voice / brand context:
${firm}

Draft to score:
"""
${truncated}
"""

Return JSON only:
{
  "brand_voice_score": <0-100>,
  "brand_voice_findings": ["finding 1", "finding 2", ...],
  "summary": "One sentence: is this on-brand? What's the headline issue?"
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{
      brand_voice_score: number;
      brand_voice_findings: string[];
      summary: string;
    }>(text);
    return {
      score: Math.max(0, Math.min(100, parsed.brand_voice_score ?? 0)),
      findings: parsed.brand_voice_findings ?? [],
      summary: parsed.summary ?? "",
    };
  } catch {
    return {
      score: null,
      findings: [
        "Brand voice scoring couldn't run (Claude call failed). Click Re-run analysis to retry.",
      ],
      summary: "",
    };
  }
}

/**
 * Map a draft's format to the compliance surface so the checker applies the
 * right obligations (e.g. the "Attorney Advertising" label applies to a blog
 * post but not to a social caption the same way). Drafts are firm-owned
 * content, so unknown formats default to "blog".
 */
function formatToComplianceSurface(format: string | null): ContentSurface {
  const f = (format ?? "").toLowerCase();
  if (f.includes("email") || f.includes("newsletter")) return "email";
  if (
    /(social|linkedin|instagram|facebook|threads|tiktok|youtube|twitter|^x$|tweet)/.test(
      f,
    )
  ) {
    return "social";
  }
  if (f.includes("page") || f.includes("webpage")) return "webpage";
  return "blog";
}

export async function analyzeDraft(args: {
  draftId: string;
  body: string;
  targetKeywords?: string[];
  title?: string | null;
  topic?: string | null;
  format?: string | null;
  template?: string | null;
  practiceArea?: string | null;
}): Promise<ContentAnalysis> {
  const {
    draftId,
    body,
    targetKeywords = [],
    title = null,
    topic = null,
    format = null,
    template = null,
  } = args;
  const supabase = getSupabaseAdmin();
  const tid = await resolveTenantId();

  const { words, sentences, syllables } = basicMetrics(body);
  const flesch = fleschReadingEase(words.length, sentences, syllables);
  const grade = fleschKincaidGrade(words.length, sentences, syllables);

  const aeo = heuristicAEO(body);
  const seo = heuristicSEO({ body, title, format, template, targetKeywords });
  // Run brand voice + CASH + linkability + contentEnhancements + compliance in
  // parallel — all are Claude calls and independent of each other.
  const [brand, cash, linkability, enhancements, compliance] = await Promise.all([
    brandVoiceMatch(body, tid),
    cashScore(body),
    linkabilityScore({ body, topic: topic ?? title ?? "", title }),
    contentEnhancements({
      body,
      topic: topic ?? title ?? "",
      title,
      format,
      template,
      targetKeywords,
    }),
    // Advisory attorney-advertising compliance. Never let it fail the whole
    // analysis — degrade to a null score the UI renders as "re-run".
    checkContentCompliance({
      content: body,
      surface: formatToComplianceSurface(format),
      practiceArea: args.practiceArea ?? undefined,
    }).catch((err) => {
      console.warn("[content-analysis] Compliance check failed:", err);
      return null;
    }),
  ]);

  // Cross-check proposed titles against the firm's existing content so the
  // user doesn't accidentally write a piece that competes with an existing
  // page. Drops high-similarity matches; surfaces the count + dropped detail.
  const filtered = await filterTitlesByCannibalization(
    enhancements.titles,
    draftId,
  );
  const keptTitles = filtered.kept.map((k) => k.title);

  const analysis: ContentAnalysis = {
    readability_score: normalizeReadability(flesch),
    reading_grade_level: Math.round(grade * 10) / 10,
    word_count: words.length,
    sentence_count: sentences,
    keyword_density: keywordDensity(words),
    target_keyword_hits: targetHits(body, targetKeywords),
    aeo_score: aeo.score,
    aeo_findings: aeo.findings,
    brand_voice_score: brand.score,
    brand_voice_findings: brand.findings,
    cash_score: cash.score,
    cash_breakdown: cash.breakdown,
    cash_findings: cash.findings,
    seo_score: seo.score,
    seo_breakdown: seo.breakdown,
    seo_findings: seo.findings,
    linkability_score: linkability.score,
    linkability_findings: linkability.findings,
    outreach_angles: linkability.angles,
    compliance_score: compliance ? compliance.score : null,
    compliance_status: compliance ? compliance.status : null,
    compliance_violations: compliance ? compliance.violations : [],
    compliance_required_disclaimers: compliance
      ? compliance.requiredDisclaimers
      : [],
    compliance_summary: compliance ? compliance.summary : "",
    suggested_titles: keptTitles,
    suggested_titles_dropped: filtered.dropped,
    suggested_titles_conflicts_avoided: filtered.dropped.length,
    suggested_images: enhancements.images,
    summary: brand.summary,
  };

  // Strip live-only fields (cannibalization detail) before persisting —
  // they're metadata for the current response, not stored columns.
  const persistable = { ...analysis };
  delete (persistable as Partial<ContentAnalysis>).suggested_titles_dropped;
  delete (persistable as Partial<ContentAnalysis>).suggested_titles_conflicts_avoided;

  // Graceful column-degradation. If new columns aren't migrated yet, drop
  // the offending fields and retry. Newest columns (compliance_*) drop first,
  // then suggested_titles / suggested_images, then seo_/linkability_/
  // outreach_angles, then CASH-era columns. Each retry strips one generation of
  // columns. Stripping mutates `persistable` so later retries stay cumulative.
  let { error } = await supabase.from("content_analyses").insert({ tenant_id: tid,
    draft_id: draftId,
    ...persistable,
  });
  if (error && /compliance_/.test(error.message)) {
    for (const k of [
      "compliance_score",
      "compliance_status",
      "compliance_violations",
      "compliance_required_disclaimers",
      "compliance_summary",
    ] as const) {
      delete (persistable as Record<string, unknown>)[k];
    }
    const retry = await supabase.from("content_analyses").insert({ tenant_id: tid,
      draft_id: draftId,
      ...persistable,
    });
    error = retry.error;
  }
  if (error && /(suggested_titles|suggested_images)/.test(error.message)) {
    const withoutEnhancements = { ...persistable };
    delete (withoutEnhancements as Partial<ContentAnalysis>).suggested_titles;
    delete (withoutEnhancements as Partial<ContentAnalysis>).suggested_images;
    const retry = await supabase.from("content_analyses").insert({ tenant_id: tid,
      draft_id: draftId,
      ...withoutEnhancements,
    });
    error = retry.error;
  }
  if (error && /(seo_|linkability_|outreach_angles)/.test(error.message)) {
    const withoutNew = {
      readability_score: analysis.readability_score,
      reading_grade_level: analysis.reading_grade_level,
      word_count: analysis.word_count,
      sentence_count: analysis.sentence_count,
      keyword_density: analysis.keyword_density,
      target_keyword_hits: analysis.target_keyword_hits,
      aeo_score: analysis.aeo_score,
      aeo_findings: analysis.aeo_findings,
      brand_voice_score: analysis.brand_voice_score,
      brand_voice_findings: analysis.brand_voice_findings,
      cash_score: analysis.cash_score,
      cash_breakdown: analysis.cash_breakdown,
      cash_findings: analysis.cash_findings,
      summary: analysis.summary,
    };
    const retry = await supabase.from("content_analyses").insert({ tenant_id: tid,
      draft_id: draftId,
      ...withoutNew,
    });
    error = retry.error;
  }
  if (error && /cash_/.test(error.message)) {
    await supabase.from("content_analyses").insert({ tenant_id: tid,
      draft_id: draftId,
      readability_score: analysis.readability_score,
      reading_grade_level: analysis.reading_grade_level,
      word_count: analysis.word_count,
      sentence_count: analysis.sentence_count,
      keyword_density: analysis.keyword_density,
      target_keyword_hits: analysis.target_keyword_hits,
      aeo_score: analysis.aeo_score,
      aeo_findings: analysis.aeo_findings,
      brand_voice_score: analysis.brand_voice_score,
      brand_voice_findings: analysis.brand_voice_findings,
      summary: analysis.summary,
    });
  }

  return analysis;
}
