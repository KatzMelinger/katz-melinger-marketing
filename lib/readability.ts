/**
 * Readability remediation — the "fix, don't just measure" layer.
 *
 * The analyzer scores readability (Flesch) but historically emitted no findings
 * and had no Apply action, so a 52 never moved. This module adds sentence-level
 * analysis (length, passive voice, grade) so we can (a) surface each over-limit
 * sentence as an Apply finding, (b) drive an auto-rewrite loop at generation
 * time, and (c) gate approval. It is pure (no LLM, no I/O) so it can be unit
 * tested and imported from any route.
 *
 * Legal terms are protected: a do-not-simplify list keeps statute names and
 * terms of art (e.g. "liquidated damages") from being dumbed down, so dense
 * legal content isn't penalized for using the law's own words.
 */

// Sentence-length thresholds. LONG = remediation flag (staff spec ~28 words);
// HARD_MAX = the generator ceiling (no sentence over 35 words).
export const LONG_SENTENCE_WORDS = 28;
export const HARD_MAX_SENTENCE_WORDS = 35;
// Flesch-Kincaid grade above which a single sentence reads as too complex.
export const HIGH_GRADE = 14;
// Approval gate: block below the floor; show the target as the goal.
export const READABILITY_FLOOR = 60;
export const READABILITY_TARGET = 70;
// Generator ceiling on passive voice.
export const MAX_PASSIVE_PCT = 10;

/**
 * Do-not-simplify list: statute short names (mirroring KM_SYSTEM_PROMPT's key
 * statutes) plus terms of art. Matched case-insensitively as substrings. Extend
 * freely — staff can add more. Shared by the Apply editor and the generator so
 * there is one source of truth.
 */
export const PROTECTED_TERMS: string[] = [
  "Fair Labor Standards Act", "FLSA",
  "New York Labor Law", "NYLL",
  "New York State Human Rights Law", "NYSHRL",
  "New York City Human Rights Law", "NYCHRL",
  "Title VII", "ADA", "FMLA", "NJLAD", "NJWHL",
  "CPLR", "FDCPA", "UCC", "Debtor and Creditor Law",
  "liquidated damages", "statute of limitations", "prima facie",
  "restraining notice", "turnover proceeding", "wage garnishment",
  "exempt employee", "non-exempt", "prevailing wage", "spread of hours",
];

const IRREGULAR_PARTICIPLES = [
  "given", "taken", "made", "paid", "held", "brought", "sought", "found",
  "shown", "known", "written", "done", "seen", "owed", "built", "kept",
  "left", "sent", "told", "awarded", "filed", "served", "denied", "granted",
  "withheld", "overpaid", "underpaid", "terminated", "retaliated",
];

const BE_VERB = "(?:is|are|was|were|be|been|being|am|get|gets|got|gotten)";
const PARTICIPLE = `(?:\\w+(?:ed|en)|${IRREGULAR_PARTICIPLES.join("|")})`;
// "was paid", "were being terminated", "is not given" — a be-verb followed
// (allowing an adverb/negator) by a past participle.
const PASSIVE_RE = new RegExp(`\\b${BE_VERB}\\b(?:\\s+(?:not|being|been|\\w+ly)){0,2}\\s+${PARTICIPLE}\\b`, "i");

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

/** Flatten Markdown to plain sentences, preserving readable sentence text. */
export function splitSentences(body: string): string[] {
  const text = (body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_>#`]/g, " ")
    .replace(/\r?\n+/g, " ");
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 3); // skip stubs
}

export type SentenceMetric = {
  text: string;
  words: number;
  passive: boolean;
  grade: number;
};

export function sentenceMetrics(sentence: string): SentenceMetric {
  const words = sentence.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let syllables = 0;
  for (const w of words) syllables += countSyllables(w);
  const grade = wordCount
    ? 0.39 * wordCount + 11.8 * (syllables / wordCount) - 15.59
    : 0;
  return {
    text: sentence,
    words: wordCount,
    passive: PASSIVE_RE.test(sentence),
    grade: Math.round(grade * 10) / 10,
  };
}

export type ReadabilityStats = {
  flesch: number;
  /** Flesch-Kincaid grade level over the same Markdown-stripped text. */
  grade: number;
  avgSentenceLen: number;
  passivePct: number;
  longestSentence: number;
  overThresholdCount: number;
  sentenceCount: number;
};

export function readabilityStats(body: string): ReadabilityStats {
  const sentences = splitSentences(body);
  if (sentences.length === 0) {
    return { flesch: 0, grade: 0, avgSentenceLen: 0, passivePct: 0, longestSentence: 0, overThresholdCount: 0, sentenceCount: 0 };
  }
  const metrics = sentences.map(sentenceMetrics);
  const totalWords = metrics.reduce((n, m) => n + m.words, 0);
  let totalSyll = 0;
  for (const s of sentences) for (const w of s.split(/\s+/).filter(Boolean)) totalSyll += countSyllables(w);
  const flesch = totalWords
    ? 206.835 - 1.015 * (totalWords / sentences.length) - 84.6 * (totalSyll / totalWords)
    : 0;
  const grade = totalWords
    ? 0.39 * (totalWords / sentences.length) + 11.8 * (totalSyll / totalWords) - 15.59
    : 0;
  const passiveCount = metrics.filter((m) => m.passive).length;
  const over = metrics.filter(
    (m) => m.words > LONG_SENTENCE_WORDS || m.passive || m.grade > HIGH_GRADE,
  ).length;
  return {
    flesch: Math.max(0, Math.min(100, Math.round(flesch))),
    grade: Math.round(Math.max(0, grade) * 10) / 10,
    avgSentenceLen: Math.round((totalWords / sentences.length) * 10) / 10,
    passivePct: Math.round((passiveCount / sentences.length) * 100),
    longestSentence: metrics.reduce((n, m) => Math.max(n, m.words), 0),
    overThresholdCount: over,
    sentenceCount: sentences.length,
  };
}

/**
 * One stable, unique finding string per over-threshold sentence. The Apply UI
 * keys batch selection on exact finding text, so each is made unique by its
 * quoted excerpt. Capped so a dense page doesn't flood the panel.
 */
export function readabilityFindings(body: string, cap = 25): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of splitSentences(body)) {
    const m = sentenceMetrics(s);
    const reasons: string[] = [];
    if (m.words > LONG_SENTENCE_WORDS) reasons.push(`long (${m.words} words)`);
    if (m.passive) reasons.push("passive voice");
    if (m.grade > HIGH_GRADE) reasons.push(`grade ${m.grade}`);
    if (reasons.length === 0) continue;
    const quote = s.length > 70 ? `${s.slice(0, 70)}...` : s;
    const finding = `Hard to read (${reasons.join(", ")}). Split into shorter, active sentences, keeping legal terms verbatim: "${quote}"`;
    if (seen.has(finding)) continue;
    seen.add(finding);
    out.push(finding);
    if (out.length >= cap) break;
  }
  return out;
}

/** Hard-constraint block injected into the generator prompts. */
export function renderReadabilityRules(): string {
  return [
    "READABILITY RULES (hard constraints):",
    `- Average sentence under 20 words. No sentence over ${HARD_MAX_SENTENCE_WORDS} words. If a sentence runs long, split it into two.`,
    `- Passive voice under ${MAX_PASSIVE_PCT}% of sentences. Prefer active voice ("the employer withheld your pay", not "your pay was withheld").`,
    "- No conditional openers (\"If you believe...\", \"Should you find...\").",
    "- Define legal terms in plain English, but keep the term itself verbatim. Do NOT simplify away statute names or terms of art (e.g. \"liquidated damages\", \"Fair Labor Standards Act\").",
  ].join("\n");
}

export function passesReadabilityGate(score: number | null | undefined): boolean {
  return typeof score === "number" && score >= READABILITY_FLOOR;
}
