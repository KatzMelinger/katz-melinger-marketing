/**
 * Readability checks — pure functions over a parsed Plaintext.
 *
 * Phase 1 scope: sentence-length and paragraph-length (spec Priority 1). Later
 * phases add passive voice, transitions, openers, and subheading gaps here on
 * the same shape. Every function is pure and dependency-free so it runs
 * identically on the server (to persist summary counts) and in a client
 * component (to recompute flagged ranges for inline highlighting) — same body
 * + same thresholds ⇒ same result, so the panel and the stored chip agree.
 */

import type { Plaintext, Sentence } from "./plaintext";
import {
  classify,
  rollup,
  type MetricThreshold,
  type ReadabilityThresholds,
  type Status,
} from "./config";

/** A flagged span, in original-source character offsets, for highlighting. */
export type FlaggedRange = {
  start: number;
  end: number;
  words: number;
  severity: Exclude<Status, "green">;
  text: string;
};

export type LengthAnalysis = {
  avgSentenceLength: number;
  longSentences: FlaggedRange[];
  longParagraphs: FlaggedRange[];
  longSentencesCount: number;
  longParagraphsCount: number;
  sentenceStatus: Status;
  paragraphStatus: Status;
  /** Worst-of across the length sub-metrics. */
  overallStatus: Status;
};

/** Worst severity among a set of flagged ranges (green if none flagged). */
function worstSeverity(ranges: FlaggedRange[]): Status {
  return rollup(ranges.map((r) => r.severity));
}

/**
 * Sentence- and paragraph-length analysis. A sentence/paragraph is "flagged"
 * when its word count classifies amber or red against the tenant's thresholds;
 * green items are dropped from the flag lists but still count toward the average.
 */
export function analyzeLengths(
  pt: Plaintext,
  t: ReadabilityThresholds,
): LengthAnalysis {
  const sentences = pt.sentences;
  const totalWords = sentences.reduce((sum, s) => sum + s.wordCount, 0);
  const avgSentenceLength = sentences.length
    ? Math.round((totalWords / sentences.length) * 10) / 10
    : 0;

  const longSentences: FlaggedRange[] = [];
  for (const s of sentences) {
    const severity = classify(s.wordCount, t.longSentenceWords);
    if (severity !== "green") {
      longSentences.push({
        start: s.start,
        end: s.end,
        words: s.wordCount,
        severity,
        text: s.text,
      });
    }
  }

  const longParagraphs: FlaggedRange[] = [];
  for (const p of pt.paragraphs) {
    const severity = classify(p.wordCount, t.longParagraphWords);
    if (severity !== "green") {
      longParagraphs.push({
        start: p.start,
        end: p.end,
        words: p.wordCount,
        severity,
        text: p.text,
      });
    }
  }

  const sentenceStatus = worstSeverity(longSentences);
  const paragraphStatus = worstSeverity(longParagraphs);

  return {
    avgSentenceLength,
    longSentences,
    longParagraphs,
    longSentencesCount: longSentences.length,
    longParagraphsCount: longParagraphs.length,
    sentenceStatus,
    paragraphStatus,
    overallStatus: rollup([sentenceStatus, paragraphStatus]),
  };
}

// ---------------------------------------------------------------------------
// Passive voice (spec Priority 3)
// ---------------------------------------------------------------------------

// Forms of "to be" that, followed by a past participle, signal passive voice.
const BE_FORMS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "get", "gets",
  "got", "gotten",
]);

// Words that look like "be + participle" but are almost always adjectival or
// otherwise not passive — keeps false positives down on legal copy.
const NOT_PASSIVE_PARTICIPLES = new Set([
  "interested", "concerned", "located", "limited", "related", "involved",
  "experienced", "dedicated", "qualified", "licensed", "based", "supposed",
  "used", "tired", "pleased", "needed",
]);

// Common irregular past participles (don't end in -ed).
const IRREGULAR_PARTICIPLES = new Set([
  "given", "taken", "made", "done", "seen", "known", "shown", "found", "held",
  "brought", "bought", "caught", "taught", "thought", "sought", "told", "sold",
  "paid", "said", "left", "kept", "built", "sent", "spent", "lost", "won",
  "met", "led", "read", "set", "put", "cut", "hit", "let", "hurt", "cost",
  "written", "driven", "broken", "chosen", "spoken", "stolen", "frozen",
  "forgotten", "hidden", "beaten", "eaten", "fallen", "drawn", "thrown",
  "grown", "blown", "flown", "worn", "torn", "born", "sworn", "dealt", "felt",
  "meant", "heard", "understood", "withheld", "awarded", "filed", "served",
]);

function isPastParticiple(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w || NOT_PASSIVE_PARTICIPLES.has(w)) return false;
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  // Regular participles end in -ed (but skip very short words like "red").
  return w.length > 3 && w.endsWith("ed");
}

const PASSIVE_TOKEN_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

/** Heuristic: a "to be" form followed within a few tokens by a past participle. */
function sentenceIsPassive(text: string): boolean {
  const tokens = text.toLowerCase().match(PASSIVE_TOKEN_RE);
  if (!tokens) return false;
  for (let i = 0; i < tokens.length; i++) {
    if (!BE_FORMS.has(tokens[i])) continue;
    // Allow up to two intervening adverbs/words ("was clearly written").
    for (let j = i + 1; j <= i + 3 && j < tokens.length; j++) {
      if (isPastParticiple(tokens[j])) return true;
      // "not"/adverbs may sit between; "by" after the participle is a strong
      // signal but we don't require it.
    }
  }
  return false;
}

export type PassiveSentence = { start: number; end: number; text: string };

export type PassiveAnalysis = {
  passiveSentences: PassiveSentence[];
  /** Percentage of sentences in passive voice (0–100). */
  passivePct: number;
  status: Status;
};

/** Detect passive-voice sentences and the document-level passive percentage. */
export function analyzePassive(
  pt: Plaintext,
  t: ReadabilityThresholds,
): PassiveAnalysis {
  const sentences: Sentence[] = pt.sentences;
  const passiveSentences: PassiveSentence[] = [];
  for (const s of sentences) {
    if (sentenceIsPassive(s.text)) {
      passiveSentences.push({ start: s.start, end: s.end, text: s.text });
    }
  }
  const passivePct = sentences.length
    ? Math.round((passiveSentences.length / sentences.length) * 1000) / 10
    : 0;
  return {
    passiveSentences,
    passivePct,
    status: classify(passivePct, t.passiveVoicePct),
  };
}

/** Status for a Flesch–Kincaid grade level against the tenant's band. */
export function gradeStatus(grade: number, t: MetricThreshold): Status {
  return classify(grade, t);
}
