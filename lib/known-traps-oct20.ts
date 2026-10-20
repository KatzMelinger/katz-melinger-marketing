/**
 * Diana's Oct 20 2026 spec, Part 2: trap changes Kenneth approved the same
 * day. Trap 27 and 27es themselves stay in lib/known-traps-oct6.ts (their
 * source); this file holds what is new or retired, for
 * scripts/apply-oct20-traps.ts and scripts/check-known-traps-oct20.ts.
 *
 *   Item 7  A guarantee trap: "always" or "almost always" before negotiable,
 *           win or recover. eb5d488b said severance agreements are "almost
 *           always negotiable"; the approved wording is "often negotiable".
 *   Item 9  Trap 8 "Hyphenated compound word" is retired: since October 7
 *           hyphens are allowed wherever grammatically correct (non-exempt,
 *           self-check). Em dashes and en dashes stay banned (Trap 6).
 *
 * Pure data, no IO.
 */
import type { TrapSeed } from "./known-traps-oct6";

export const GUARANTEE_TRAP: TrapSeed = {
  number: "32",
  label: "Outcome stated as certain (always negotiable, always win)",
  matchType: "regex",
  matchOn: "sentences",
  pattern: String.raw`\b(?:almost\s+)?always\s+(?:be\s+|are\s+|is\s+)?(?:negotiable|win|wins|won|recover|recovers|recovered|succeed|succeeds|prevail|prevails)\b`,
  unless: [],
  severity: "critical",
  note: "No guarantees or implied certainty about results (Oct 20 spec, Part 2 item 7). Say \"often\" instead: \"severance agreements are often negotiable\".",
};

/** Labels of traps switched off, with the reason recorded on their findings. */
export const RETIRED_TRAPS: { label: string; reason: string }[] = [
  {
    label: "Hyphenated compound word",
    reason: "Retired (Oct 20 spec, Part 2 item 9): hyphens are allowed wherever grammatically correct since October 7. Em and en dashes stay banned.",
  },
];

/** Hand-verified text corrections (Oct 20 spec, Part 2 item 7). */
export const OCT20_CORRECTIONS: { draftPrefix: string; find: string; replace: string; reason: string }[] = [
  {
    draftPrefix: "eb5d488b",
    find: "almost always negotiable",
    replace: "often negotiable",
    reason: "No implied certainty about results (Oct 20 spec, Part 2 item 7).",
  },
];
