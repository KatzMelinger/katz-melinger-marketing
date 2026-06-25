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
  TRANSITION_WORDS,
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

// ---------------------------------------------------------------------------
// Transition words (spec Priority 4)
// ---------------------------------------------------------------------------

// Longest phrases first so multi-word transitions win over their prefixes.
const TRANSITIONS_BY_LENGTH = [...TRANSITION_WORDS].sort(
  (a, b) => b.length - a.length,
);

/** A sentence "uses a transition" when its opening matches a transition phrase. */
function opensWithTransition(text: string): boolean {
  const head = text.toLowerCase().replace(/^[^a-z]+/, "");
  for (const phrase of TRANSITIONS_BY_LENGTH) {
    if (head === phrase || head.startsWith(`${phrase} `) || head.startsWith(`${phrase},`)) {
      return true;
    }
  }
  return false;
}

export type TransitionAnalysis = {
  /** Percentage of sentences opening with a transition (0–100). */
  transitionPct: number;
  transitionCount: number;
  status: Status;
};

export function analyzeTransitions(
  pt: Plaintext,
  t: ReadabilityThresholds,
): TransitionAnalysis {
  const sentences = pt.sentences;
  let count = 0;
  for (const s of sentences) if (opensWithTransition(s.text)) count++;
  const transitionPct = sentences.length
    ? Math.round((count / sentences.length) * 1000) / 10
    : 0;
  return {
    transitionPct,
    transitionCount: count,
    status: classify(transitionPct, t.transitionWordPct),
  };
}

// ---------------------------------------------------------------------------
// Consecutive sentence openers (spec Priority 5)
// ---------------------------------------------------------------------------

function firstWord(text: string): string {
  const m = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/);
  return m ? m[0] : "";
}

export type OpenerRun = { word: string; count: number; start: number; end: number };

export type OpenerAnalysis = {
  /** Runs of >=3 consecutive sentences sharing the same opening word. */
  runs: OpenerRun[];
  runsCount: number;
  status: Status;
};

export function analyzeOpeners(
  pt: Plaintext,
  t: ReadabilityThresholds,
): OpenerAnalysis {
  const sentences = pt.sentences;
  const runs: OpenerRun[] = [];
  let i = 0;
  while (i < sentences.length) {
    const word = firstWord(sentences[i].text);
    let j = i + 1;
    while (j < sentences.length && word && firstWord(sentences[j].text) === word) j++;
    const len = j - i;
    if (word && len >= 3) {
      runs.push({
        word,
        count: len,
        start: sentences[i].start,
        end: sentences[j - 1].end,
      });
    }
    i = j;
  }
  return {
    runs,
    runsCount: runs.length,
    status: classify(runs.length, t.consecutiveOpeners),
  };
}

// ---------------------------------------------------------------------------
// Subheading gaps (spec Priority 5)
// ---------------------------------------------------------------------------

export type SubheadingGap = { start: number; end: number; words: number };

export type SubheadingAnalysis = {
  gaps: SubheadingGap[];
  /** Count of stretches whose word span exceeds the green threshold. */
  gapCount: number;
  maxGapWords: number;
  status: Status;
};

/**
 * Word spans between consecutive H2/H3 subheadings (plus the lead before the
 * first and the tail after the last). A "gap" is a span over the green cutoff;
 * status classifies the LARGEST span so one long unbroken stretch shows red.
 */
export function analyzeSubheadingGaps(
  pt: Plaintext,
  t: ReadabilityThresholds,
): SubheadingAnalysis {
  const band = t.subheadingGapWords;
  // Boundaries: document start, each H2/H3 start, document end.
  const subheadings = pt.headings.filter((h) => h.level >= 2);
  const docStart = 0;
  const docEnd = pt.paragraphs.length
    ? Math.max(...pt.paragraphs.map((p) => p.end))
    : 0;
  const bounds = [docStart, ...subheadings.map((h) => h.start), docEnd].sort(
    (a, b) => a - b,
  );

  const gaps: SubheadingGap[] = [];
  let maxGapWords = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const segStart = bounds[i];
    const segEnd = bounds[i + 1];
    let words = 0;
    for (const p of pt.paragraphs) {
      if (p.start >= segStart && p.start < segEnd) words += p.wordCount;
    }
    maxGapWords = Math.max(maxGapWords, words);
    if (words > band.green) gaps.push({ start: segStart, end: segEnd, words });
  }
  return {
    gaps,
    gapCount: gaps.length,
    maxGapWords,
    status: classify(maxGapWords, band),
  };
}
