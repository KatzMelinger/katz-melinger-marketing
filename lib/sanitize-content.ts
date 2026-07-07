/**
 * Post-generation content sanitizer — the hard floor for brand-voice rules
 * that the model cannot be trusted to follow from prompt instructions alone.
 *
 * The "no em dashes" rule lived only as prompt text (see anti-ai-voice.ts and
 * km-content-system.ts), and the model still let them through — that is exactly
 * how an em dash reached the published litigation draft. This runs AFTER
 * generation and strips em/en dashes regardless of what the model produced, so
 * it is impossible for one to reach a draft.
 *
 * Apply this to every generator's output (title, body, and any subject/preview
 * fields) at the point the text is produced or persisted.
 */

/** All Unicode dash characters that read as em/en dashes (not the ASCII hyphen). */
const DASH_CLASS = "\\u2012\\u2013\\u2014\\u2015";
// Number range: "5–7" / "5 — 7" → "5-7" (a plain hyphen range reads naturally).
const NUM_RANGE = new RegExp(`(\\d)\\s*[${DASH_CLASS}]\\s*(\\d)`, "g");
// Any remaining em/en dash used as punctuation → comma. Collapses surrounding
// whitespace so "word — word" and "word—word" both become "word, word".
const PUNCT_DASH = new RegExp(`\\s*[${DASH_CLASS}]\\s*`, "g");
// A spaced double-hyphen is a common ASCII stand-in for an em dash.
const ASCII_EM = /\s+--\s+/g;

/**
 * Remove em/en dashes from a single string, leaving legitimate hyphenated
 * words ("non-compete", "New York-based") untouched. Idempotent.
 */
export function stripEmDashes(input: string | null | undefined): string {
  if (!input) return input ?? "";
  let out = input
    .replace(NUM_RANGE, "$1-$2")
    .replace(ASCII_EM, ", ")
    .replace(PUNCT_DASH, ", ");
  // Cleanup artifacts from the comma substitution.
  out = out
    .replace(/,\s*([.,;:!?])/g, "$1") // ", ." -> "."
    .replace(/([([{])\s*,\s*/g, "$1") // "( , " -> "("
    .replace(/,\s*,/g, ",") // ", ," -> ","
    .replace(/ {2,}/g, " "); // collapse doubled spaces
  return out;
}

/** True if any em/en dash (or spaced double-hyphen) is present. */
export function hasEmDash(input: string | null | undefined): boolean {
  if (!input) return false;
  return new RegExp(`[${DASH_CLASS}]`).test(input) || ASCII_EM.test(input);
}
