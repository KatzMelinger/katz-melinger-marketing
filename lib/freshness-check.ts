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

// Markup / non-prose patterns stripped BEFORE figure detection, so the scanner
// only ever sees the text a reader sees. Order matters — see toSentences.
const HTML_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_RE = /<[^>]+>/g; // any tag + its attributes → drops href/src URLs
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK_RE = /\[([^\]]+)\]\([^)]*\)/g; // keep anchor text, drop the URL
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;
const SCHEME_RE = /\b(?:tel|mailto):[^\s)]+/gi;
// US phone numbers (212-460-0047, (212) 460-0047, +1 212 460 0047, 2124600047).
// Static contact info, never a time-sensitive figure — and the digit groups here
// never form a valid $amount or 19xx/20xx year, so removing them only cuts noise.
const PHONE_RE =
  /\b(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&lt;": " ", "&gt;": " ", // decode to space, never back into angle brackets
};
function decodeEntities(s: string): string {
  return s.replace(/&(?:nbsp|amp|quot|#39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? " ");
}

/**
 * Reduce a draft body to the plain text a reader actually sees, then split into
 * sentences. Critically this scans RENDERED text, not markup: HTML tags and their
 * attributes (href targets, URL paths), markdown link URLs, tel:/mailto: links,
 * bare URLs, and phone numbers are all removed BEFORE figure detection — so the
 * "2020" inside /blog/2020/06/, the firm's phone number, and <p>/<h2> tags never
 * read as figures. Bodies reach here as Markdown, HTML, or a mix; handle all.
 */
function toSentences(body: string): string[] {
  const text = decodeEntities(
    (body ?? "")
      .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
      .replace(/`[^`]*`/g, " ") // inline code
      .replace(HTML_BLOCK_RE, " ") // <script>/<style> incl. contents
      .replace(HTML_TAG_RE, " ") // all HTML tags + attributes (drops href URLs)
      .replace(MD_IMAGE_RE, " ") // markdown images (alt + URL)
      .replace(MD_LINK_RE, "$1"), // markdown links → anchor text only
  )
    .replace(URL_RE, " ") // bare URLs left in prose
    .replace(SCHEME_RE, " ") // tel:/mailto: links
    .replace(PHONE_RE, " ") // phone numbers
    .replace(/^#{1,6}\s+/gm, "") // markdown heading markers
    .replace(/[*_>#`]/g, " ") // residual inline markdown
    .replace(/\r?\n+/g, " ")
    .replace(/[ \t]{2,}/g, " ");
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
