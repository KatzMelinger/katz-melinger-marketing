/**
 * Freshness check — flags time-sensitive facts that must be verified before a
 * legal draft is approved.
 *
 * The failure this guards against: a content refresh silently carried forward
 * stale minimum-wage figures (2018–2020 dollar amounts quoted as current).
 * Anything this returns should be human-verified or updated; for legal content
 * it is a hard QA gate (enforced in the draft drawer). It does not judge whether
 * a figure is wrong — it surfaces every figure that COULD be stale so a human
 * confirms it, which is the safe default for statutory numbers.
 */

export type FreshnessKind =
  | "dollar_amount"
  | "year"
  | "currency_phrase"
  | "statutory_threshold";

export type FreshnessFlag = {
  kind: FreshnessKind;
  /** The exact matched token, e.g. "$15.50" or "2019". */
  match: string;
  /** The enclosing sentence, so the reviewer sees exactly what to check. */
  sentence: string;
};

const DOLLAR_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const CURRENCY_PHRASE_RE =
  /\b(currently|as of|effective(?: on| as of)?|starting|beginning(?: in| on)?|this year|per year|in \d{4})\b/gi;
const THRESHOLD_RE =
  /\b(minimum wage|tipped (?:minimum )?wage|salary (?:threshold|basis|exemption|level|cap)|exempt(?:ion)? threshold|overtime threshold|statute of limitations|filing deadline|deadline to file)\b/gi;

/**
 * Flatten Markdown into plain sentences: drop code blocks and heading markers,
 * unwrap links to their anchor text, strip inline markup, then split on
 * sentence boundaries. Good enough to give the reviewer a readable snippet.
 */
function toSentences(body: string): string[] {
  const text = (body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_>#`]/g, " ")
    .replace(/\r?\n+/g, " ");
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findTimeSensitiveFacts(body: string): FreshnessFlag[] {
  const sentences = toSentences(body);
  const flags: FreshnessFlag[] = [];
  const seen = new Set<string>();

  const push = (kind: FreshnessKind, match: string, sentence: string) => {
    const key = `${kind}::${match.toLowerCase()}::${sentence.slice(0, 60).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ kind, match: match.trim(), sentence: sentence.trim() });
  };

  for (const s of sentences) {
    for (const m of s.match(DOLLAR_RE) ?? []) push("dollar_amount", m, s);
    for (const m of s.match(YEAR_RE) ?? []) push("year", m, s);
    for (const m of s.match(THRESHOLD_RE) ?? []) push("statutory_threshold", m, s);
    // A "currently / as of" phrase only matters when the sentence also carries a
    // number — otherwise it isn't a time-sensitive figure.
    const phrases = s.match(CURRENCY_PHRASE_RE);
    if (phrases && /\d/.test(s)) push("currency_phrase", phrases[0], s);
  }

  return flags.slice(0, 40);
}
