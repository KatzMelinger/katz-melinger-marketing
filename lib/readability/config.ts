/**
 * Readability thresholds — code defaults + status classification.
 *
 * These are the shipped fallback/seed values. The live cutoffs are
 * tenant-editable: `lib/readability/thresholds-store.ts` deep-merges a tenant's
 * saved `config` over DEFAULT_THRESHOLDS, so a partial/empty config still yields
 * a full set and any metric added here later inherits its default until edited.
 *
 * `direction` is code-owned (semantic), never user-editable — only the green/
 * amber numbers come from the tenant. The UI edits two numbers per metric.
 *
 * Defaults are general-web/Yoast-style and WILL over-flag formal legal writing;
 * calibrate against real KM drafts before relying on the colors (see plan §7).
 */

export type Status = "green" | "amber" | "red";

/**
 * `lower`  — smaller is better (sentence length, passive %, grade level…):
 *            value <= green → green; value <= amber → amber; else red.
 * `higher` — larger is better (transition word %):
 *            value >= green → green; value >= amber → amber; else red.
 */
export type ThresholdDirection = "lower" | "higher";

export type MetricThreshold = {
  /** Inclusive boundary for a green result. */
  green: number;
  /** Inclusive boundary for an amber result (beyond it is red). */
  amber: number;
  direction: ThresholdDirection;
};

export type ReadabilityMetric =
  | "longSentenceWords"
  | "longParagraphWords"
  | "passiveVoicePct"
  | "transitionWordPct"
  | "consecutiveOpeners"
  | "subheadingGapWords"
  | "fkGradeLevel";

export type ReadabilityThresholds = Record<ReadabilityMetric, MetricThreshold>;

/** Human labels for the Content Standards editor. */
export const METRIC_LABELS: Record<ReadabilityMetric, string> = {
  longSentenceWords: "Long sentence (words)",
  longParagraphWords: "Long paragraph (words)",
  passiveVoicePct: "Passive voice (%)",
  transitionWordPct: "Transition words (%)",
  consecutiveOpeners: "Consecutive sentence openers",
  subheadingGapWords: "Subheading gap (words between H2/H3)",
  fkGradeLevel: "Flesch–Kincaid grade level",
};

export const DEFAULT_THRESHOLDS: ReadabilityThresholds = {
  longSentenceWords: { green: 20, amber: 25, direction: "lower" },
  longParagraphWords: { green: 120, amber: 160, direction: "lower" },
  passiveVoicePct: { green: 10, amber: 15, direction: "lower" },
  transitionWordPct: { green: 30, amber: 20, direction: "higher" },
  consecutiveOpeners: { green: 0, amber: 1, direction: "lower" },
  subheadingGapWords: { green: 300, amber: 350, direction: "lower" },
  fkGradeLevel: { green: 9, amber: 12, direction: "lower" },
};

/** Classify a measured value into a status using one metric's bands. */
export function classify(value: number, t: MetricThreshold): Status {
  if (t.direction === "lower") {
    if (value <= t.green) return "green";
    if (value <= t.amber) return "amber";
    return "red";
  }
  // higher-is-better
  if (value >= t.green) return "green";
  if (value >= t.amber) return "amber";
  return "red";
}

/** Worst-of rollup: any red ⇒ red, else any amber ⇒ amber, else green. */
export function rollup(statuses: Status[]): Status {
  if (statuses.some((s) => s === "red")) return "red";
  if (statuses.some((s) => s === "amber")) return "amber";
  return "green";
}

type PartialMetric = Partial<Pick<MetricThreshold, "green" | "amber">>;
type PartialThresholds = Partial<Record<ReadabilityMetric, PartialMetric | null | undefined>>;

/**
 * Deep-merge a tenant's stored config over the code defaults. Only the green/
 * amber numbers are taken from the tenant; `direction` always comes from the
 * defaults. Non-numeric or missing values fall back per-field.
 */
export function mergeThresholds(partial: PartialThresholds | null | undefined): ReadabilityThresholds {
  const out = {} as ReadabilityThresholds;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as ReadabilityMetric[]) {
    const def = DEFAULT_THRESHOLDS[key];
    const p = partial?.[key];
    out[key] = {
      green: typeof p?.green === "number" ? p.green : def.green,
      amber: typeof p?.amber === "number" ? p.amber : def.amber,
      direction: def.direction,
    };
  }
  return out;
}
