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
import { getFirmContext } from "./firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";

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

export type ContentAnalysis = {
  readability_score: number;
  reading_grade_level: number;
  word_count: number;
  sentence_count: number;
  keyword_density: Record<string, number>;
  target_keyword_hits: Record<string, number>;
  aeo_score: number;
  aeo_findings: string[];
  brand_voice_score: number;
  brand_voice_findings: string[];
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

function targetHits(body: string, targets: string[]): Record<string, number> {
  const lc = body.toLowerCase();
  const out: Record<string, number> = {};
  for (const t of targets) {
    if (!t) continue;
    const re = new RegExp(`\\b${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const matches = lc.match(re);
    out[t] = matches?.length ?? 0;
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

async function brandVoiceMatch(body: string): Promise<{ score: number; findings: string[]; summary: string }> {
  const firm = await getFirmContext();
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
    return { score: 0, findings: ["Brand voice scoring failed; check Anthropic API key."], summary: "" };
  }
}

export async function analyzeDraft(args: {
  draftId: string;
  body: string;
  targetKeywords?: string[];
}): Promise<ContentAnalysis> {
  const { draftId, body, targetKeywords = [] } = args;
  const supabase = getSupabaseAdmin();

  const { words, sentences, syllables } = basicMetrics(body);
  const flesch = fleschReadingEase(words.length, sentences, syllables);
  const grade = fleschKincaidGrade(words.length, sentences, syllables);

  const aeo = heuristicAEO(body);
  const brand = await brandVoiceMatch(body);

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
    summary: brand.summary,
  };

  await supabase.from("content_analyses").insert({
    draft_id: draftId,
    ...analysis,
  });

  return analysis;
}
