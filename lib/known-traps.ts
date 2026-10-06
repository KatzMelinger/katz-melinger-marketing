/**
 * Known traps — errors the firm has already been caught by once.
 *
 * B6: "The same error cannot be fixed across all drafts at once." The EEOC and
 * Title VII mistake appeared in both the body and the FAQ of the FMLA post, and
 * patterns like the section 198-c claim almost certainly recur elsewhere.
 * Fixing one instance does not fix the pattern, and nothing could answer "how
 * many other drafts say this".
 *
 * A trap is a SEARCH PATTERN, not a legal fact. That distinction is what makes
 * this buildable today: it does not need the knowledge base, retrieval, or any
 * judgment about what the law says. It needs only "here is a shape of text that
 * has been wrong before — show me everywhere it appears."
 *
 * A hit is a SUSPICION, never a verdict. Most of these patterns catch correct
 * writing too: a draft can mention the FMLA and the EEOC in the same paragraph
 * perfectly properly. The output is a reviewer's worklist, and the UI says so.
 * Getting this backwards — treating a hit as an error — would be the same
 * mistake as a green scoreboard, pointed the other way.
 *
 * Pure module: no database, no IO, so the matching is unit-testable.
 */

export type TrapMatchType =
  /** Case-insensitive substring. */
  | "phrase"
  /** A regular expression, matched case-insensitively. */
  | "regex"
  /**
   * Every term must appear somewhere in the draft. This is the one that catches
   * the real legal traps, which are almost never a single phrase: "FMLA" is
   * fine, "EEOC" is fine, and the two together is what warrants a look.
   */
  | "all_of"
  /**
   * Every term in `terms` must appear, and none in `unless`. Lets a trap
   * exclude the correct phrasing — the draft that already says the right thing
   * should not sit in the worklist forever.
   */
  | "all_of_unless"
  /**
   * Oct 6 spec: fires when ONE sentence carries every pattern term (or matches
   * the pattern as a regex when it is not a JSON array) and the WHOLE draft
   * carries none of the `unless` terms. "A client result without the prior
   * results line" is this shape: the result is in one sentence, the line that
   * clears it can be anywhere.
   */
  | "document"
  /** Fires when the pattern (a regex, multiline) does NOT match the body. */
  | "document_missing";

/**
 * Where a trap looks (Oct 6 spec, Task 4).
 *
 *   null              the original behaviour: the whole draft, with markdown
 *                     links reduced to their anchor text (Task 3). Every trap
 *                     that existed before 2026-10-06 runs this way, so their
 *                     tested patterns behave exactly as before.
 *   "sentences"       one sentence at a time, links reduced to anchor text.
 *                     `unless` then clears a SENTENCE, which is what most
 *                     legal traps mean ("this sentence says X without Y").
 *   "raw_body"        the stored markdown as is (link targets, internal
 *                     blocks, citations the state-name rule broke).
 */
export type TrapMatchOn = "sentences" | "raw_body" | null;

export type KnownTrap = {
  id: string;
  label: string;
  matchType: TrapMatchType;
  /** Substring or regex source for phrase/regex; JSON array for all_of forms. */
  pattern: string;
  /** Terms whose presence clears the hit (per sentence in sentence mode). */
  unless: string[];
  severity: "critical" | "important" | "advisory";
  /** What is actually wrong, and what the correct statement is. */
  note: string;
  enabled: boolean;
  matchOn?: TrapMatchOn;
  /** True: the regex is matched case-sensitively (no "i" flag). */
  caseSensitive?: boolean;
  /** Extra RegExp flags, e.g. "u" for the emoji ranges. */
  regexFlags?: string | null;
  /**
   * "title_or_keyword_contains:harass": the trap only runs when the title,
   * topic or primary keyword contains that text.
   */
  scope?: string | null;
  /** "web": blogs and web pages only (structure rules a social post cannot meet). */
  appliesTo?: "all" | "web";
};

/** What a scoped trap is checked against. */
export type TrapContext = {
  title?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  /** False for social posts and email: "web" traps are skipped. */
  isWebPage?: boolean;
};

/** A database row (snake_case) to a trap. One mapping for every loader. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTrap(r: any): KnownTrap {
  return {
    id: r.id,
    label: r.label,
    matchType: r.match_type,
    pattern: r.pattern,
    unless: Array.isArray(r.unless) ? r.unless : [],
    severity: r.severity,
    note: r.note,
    enabled: r.enabled !== false,
    matchOn: r.match_on === "sentences" || r.match_on === "raw_body" ? r.match_on : null,
    caseSensitive: r.case_sensitive === true,
    regexFlags: typeof r.regex_flags === "string" && r.regex_flags ? r.regex_flags : null,
    scope: typeof r.scope === "string" && r.scope ? r.scope : null,
    appliesTo: r.applies_to === "web" ? "web" : "all",
  };
}

/** Task 3: "[anchor](url)" becomes "anchor", so a link inside a sentence cannot hide it. */
export function stripLinks(s: string): string {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

// Abbreviations whose period does not end a sentence: case names ("v."),
// reporters ("N.Y.2d", "U.S.C."), titles and the usual Latin.
const NO_BREAK =
  /\b(?:v|vs|Inc|Corp|Co|Ltd|No|Nos|St|Mr|Ms|Mrs|Dr|Esq|Jr|Sr|e\.g|i\.e|etc|Admin|Super|Supp|Cir|App|Div|Dep't|Ct|Rev|Stat|Ann|Reg|Fed|Ch|art|seq)\.|\b(?:[A-Z]\.){2,}(?:\d+[a-z]{1,2})?/g;

/** Sentences of the link-stripped body, with each one's offset in that text. */
export function trapSentences(body: string): { text: string; index: number }[] {
  const text = stripLinks(body);
  const masked = text.replace(NO_BREAK, (m) => m.replace(/\./g, "\u0000"));
  const out: { text: string; index: number }[] = [];
  const re = /[^\n]+?(?:[.!?]+(?=\s|$)|$)/gm;
  for (const m of masked.matchAll(re)) {
    const s = text.slice(m.index ?? 0, (m.index ?? 0) + m[0].length).trim();
    if (s) out.push({ text: s, index: m.index ?? 0 });
  }
  return out;
}

function inScope(trap: KnownTrap, ctx: TrapContext | undefined): boolean {
  if (trap.appliesTo === "web" && ctx?.isWebPage === false) return false;
  if (!trap.scope) return true;
  const [kind, value] = trap.scope.split(":");
  if (kind !== "title_or_keyword_contains" || !value) return true;
  const hay = `${ctx?.title ?? ""} ${ctx?.topic ?? ""} ${ctx?.primaryKeyword ?? ""}`.toLowerCase();
  return hay.includes(value.toLowerCase());
}

function trapRegex(trap: KnownTrap, base: string): RegExp | null {
  const flags = [...new Set(`g${trap.caseSensitive ? "" : base}${trap.regexFlags ?? ""}`)].join("");
  try {
    return new RegExp(trap.pattern, flags);
  } catch {
    console.warn(`[traps] invalid regex on "${trap.label}": ${trap.pattern}`);
    return null;
  }
}

const has = (hay: string, term: string) => hay.toLowerCase().includes(term.toLowerCase());

export type TrapHit = {
  trapId: string;
  /** The matched text plus a little context, for the worklist. */
  excerpt: string;
  /** Character offset, so the UI can order hits within a draft. */
  index: number;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-ish boundary that still matches "198-c" and "2611(4)".
 *
 * A trailing `*` makes the term a PREFIX: "waiv*" matches waiver, waive, and
 * waived, which is how the legal traps actually need to be written. Without it
 * the boundary is strict on both sides, so "198-c" does not match "198-cx" —
 * that strictness is the point for citations, and the reason prefixing is opt-in
 * rather than the default.
 */
function termRegex(term: string): RegExp {
  const prefix = term.endsWith("*");
  const body = prefix ? term.slice(0, -1) : term;
  const trailing = prefix ? "" : "(?![A-Za-z0-9])";
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(body)}${trailing}`, "i");
}

function excerptAround(body: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(body.length, index + length + 60);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function parseTerms(pattern: string): string[] {
  try {
    const parsed = JSON.parse(pattern);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    }
  } catch {
    /* not JSON — fall through */
  }
  // Tolerate a comma-separated list, since that is what a human will type.
  return pattern.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * Does this draft trip this trap? Returns every hit, or an empty array.
 *
 * For the all_of forms a "hit" is reported at the first term's location — the
 * trap is about co-occurrence, so there is no single offending span, and
 * pointing at the first term gives the reviewer somewhere to start reading.
 */
export function matchTrap(trap: KnownTrap, rawBody: string, ctx?: TrapContext): TrapHit[] {
  if (!trap.enabled || !rawBody) return [];
  if (!inScope(trap, ctx)) return [];

  if (trap.matchOn === "raw_body" && trap.matchType !== "document_missing") {
    const re = trapRegex(trap, "");
    if (!re) return [];
    return [...rawBody.matchAll(re)].map((m) => ({
      trapId: trap.id,
      index: m.index ?? 0,
      excerpt: excerptAround(rawBody, m.index ?? 0, m[0].length),
    }));
  }

  if (trap.matchType === "document_missing") {
    const re = trapRegex(trap, "m");
    if (!re || re.test(rawBody)) return [];
    return [{ trapId: trap.id, index: 0, excerpt: trap.label }];
  }

  if (trap.matchOn === "sentences" || trap.matchType === "document") {
    return matchSentences(trap, rawBody);
  }

  // The original whole-draft matching, over the link-stripped text (Task 3).
  const body = stripLinks(rawBody);
  const hits: TrapHit[] = [];

  if (trap.matchType === "phrase") {
    const re = new RegExp(escapeRe(trap.pattern), "gi");
    for (const m of body.matchAll(re)) {
      hits.push({
        trapId: trap.id,
        index: m.index ?? 0,
        excerpt: excerptAround(body, m.index ?? 0, m[0].length),
      });
    }
    return hits;
  }

  if (trap.matchType === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(trap.pattern, "gi");
    } catch {
      // A bad pattern is a configuration error, not a finding. Never throw into
      // a sweep over the whole library because one row is malformed.
      console.warn(`[traps] invalid regex on "${trap.label}": ${trap.pattern}`);
      return [];
    }
    for (const m of body.matchAll(re)) {
      hits.push({
        trapId: trap.id,
        index: m.index ?? 0,
        excerpt: excerptAround(body, m.index ?? 0, m[0].length),
      });
    }
    return hits;
  }

  // all_of / all_of_unless
  const terms = parseTerms(trap.pattern);
  if (terms.length === 0) return [];
  let firstIndex = -1;
  for (const term of terms) {
    const m = body.match(termRegex(term));
    if (!m || m.index === undefined) return [];
    if (firstIndex === -1 || m.index < firstIndex) firstIndex = m.index;
  }
  if (trap.matchType === "all_of_unless") {
    for (const term of trap.unless) {
      if (termRegex(term).test(body)) return [];
    }
  }
  return [
    {
      trapId: trap.id,
      index: firstIndex,
      excerpt: excerptAround(body, firstIndex, terms[0]?.length ?? 0),
    },
  ];
}

/**
 * Sentence mode (Oct 6 spec, Task 4). Term lists are plain case-insensitive
 * substrings ("collection agenc" matches agency and agencies). A sentence
 * carrying any `unless` term is skipped; for "document" the `unless` terms
 * clear the whole draft instead.
 */
function matchSentences(trap: KnownTrap, rawBody: string): TrapHit[] {
  const sentences = trapSentences(rawBody);
  let terms: string[] | null = null;
  try {
    const parsed = JSON.parse(trap.pattern);
    if (Array.isArray(parsed)) terms = parsed.map(String).filter((t) => t.trim());
  } catch {
    /* a regex or a phrase */
  }
  if (trap.matchType === "all_of" || trap.matchType === "all_of_unless") terms ??= parseTerms(trap.pattern);
  const re = terms ? null : trap.matchType === "phrase" ? null : trapRegex(trap, "i");
  if (!terms && !re && trap.matchType !== "phrase") return [];

  const sentenceHits = (s: string): boolean => {
    if (terms) return terms.every((t) => has(s, t));
    if (trap.matchType === "phrase") return has(s, trap.pattern);
    re!.lastIndex = 0;
    return re!.test(s);
  };

  if (trap.matchType === "document") {
    const text = stripLinks(rawBody);
    if (trap.unless.some((u) => has(text, u))) return [];
  }
  const hits: TrapHit[] = [];
  for (const s of sentences) {
    if (trap.matchType !== "document" && trap.unless.some((u) => has(s.text, u))) continue;
    if (!sentenceHits(s.text)) continue;
    hits.push({ trapId: trap.id, index: s.index, excerpt: s.text.length > 300 ? `${s.text.slice(0, 300)}…` : s.text });
  }
  return hits;
}

export type TrapScanRow = {
  draftId: string;
  title: string;
  status: string;
  hits: TrapHit[];
};

export type TrapScanResult = {
  trap: KnownTrap;
  drafts: TrapScanRow[];
  totalHits: number;
};

/** Run every enabled trap across every draft. */
export function scanForTraps(
  traps: readonly KnownTrap[],
  drafts: readonly { id: string; title: string; status: string; body: string; ctx?: TrapContext }[],
): TrapScanResult[] {
  const results: TrapScanResult[] = [];
  for (const trap of traps) {
    if (!trap.enabled) continue;
    const rows: TrapScanRow[] = [];
    let total = 0;
    for (const d of drafts) {
      const hits = matchTrap(trap, d.body ?? "", d.ctx);
      if (hits.length === 0) continue;
      rows.push({ draftId: d.id, title: d.title, status: d.status, hits });
      total += hits.length;
    }
    // Worst first: the trap sitting in the most drafts is the one where fixing
    // the pattern rather than the instance saves the most work.
    results.push({ trap, drafts: rows, totalHits: total });
  }
  return results.sort((a, b) => b.drafts.length - a.drafts.length);
}
