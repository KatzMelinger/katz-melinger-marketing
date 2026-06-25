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

import type { Plaintext } from "./plaintext";
import {
  classify,
  rollup,
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
