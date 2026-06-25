/**
 * Derive readability threshold bands from the firm's brand voice.
 *
 * Readability and brand voice measure different things (mechanics vs identity),
 * but the *bands* should follow the firm's natural register: an authoritative,
 * detailed legal voice legitimately runs longer and more formal than a concise,
 * client-facing one, and generic web defaults would fight it. This maps the
 * brand-voice signal (tone + sentence-structure style, already inferred from the
 * firm's own writing in lib/content-brand-voice.ts) onto a band set.
 *
 * Pure + dependency-free so it runs at threshold-resolution time on either the
 * RLS or the admin client.
 */

import { DEFAULT_THRESHOLDS, type ReadabilityThresholds } from "./config";

export type BrandVoiceSignals = {
  tone: string[];
  stylePreferences: string[];
};

export type Register = "formal" | "accessible" | "neutral";

// Formal/authoritative: longer sentences, denser paragraphs, more passive and a
// higher grade level are on-brand and should not be over-flagged.
const FORMAL_BANDS: ReadabilityThresholds = {
  longSentenceWords: { green: 24, amber: 30, direction: "lower" },
  longParagraphWords: { green: 150, amber: 200, direction: "lower" },
  passiveVoicePct: { green: 15, amber: 22, direction: "lower" },
  transitionWordPct: { green: 25, amber: 18, direction: "higher" },
  consecutiveOpeners: { green: 0, amber: 1, direction: "lower" },
  subheadingGapWords: { green: 350, amber: 420, direction: "lower" },
  fkGradeLevel: { green: 11, amber: 14, direction: "lower" },
};

// Concise/educational/client-facing: tighter bands toward plainer, easier copy.
const ACCESSIBLE_BANDS: ReadabilityThresholds = {
  longSentenceWords: { green: 18, amber: 22, direction: "lower" },
  longParagraphWords: { green: 100, amber: 140, direction: "lower" },
  passiveVoicePct: { green: 8, amber: 12, direction: "lower" },
  transitionWordPct: { green: 30, amber: 20, direction: "higher" },
  consecutiveOpeners: { green: 0, amber: 1, direction: "lower" },
  subheadingGapWords: { green: 250, amber: 300, direction: "lower" },
  fkGradeLevel: { green: 8, amber: 10, direction: "lower" },
};

const FORMAL_RE = /authoritative legal|detailed explanatory|formal/;
const ACCESSIBLE_RE = /concise|educational and clear|direct and client|plain|accessible/;

/** Classify the firm's register from its brand-voice signals. */
export function registerFor(signals: BrandVoiceSignals | null): Register {
  if (!signals) return "neutral";
  const text = [...signals.tone, ...signals.stylePreferences].join(" ").toLowerCase();
  const formal = FORMAL_RE.test(text);
  const accessible = ACCESSIBLE_RE.test(text);
  if (formal && !accessible) return "formal";
  if (accessible && !formal) return "accessible";
  return "neutral";
}

/** The threshold base implied by the firm's brand voice. */
export function deriveThresholdsFromBrandVoice(
  signals: BrandVoiceSignals | null,
): ReadabilityThresholds {
  switch (registerFor(signals)) {
    case "formal":
      return FORMAL_BANDS;
    case "accessible":
      return ACCESSIBLE_BANDS;
    default:
      return DEFAULT_THRESHOLDS;
  }
}
