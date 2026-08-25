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
  | "all_of_unless";

export type KnownTrap = {
  id: string;
  label: string;
  matchType: TrapMatchType;
  /** Substring or regex source for phrase/regex; JSON array for all_of forms. */
  pattern: string;
  /** For all_of_unless: terms whose presence clears the hit. */
  unless: string[];
  severity: "critical" | "important" | "advisory";
  /** What is actually wrong, and what the correct statement is. */
  note: string;
  enabled: boolean;
};

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
export function matchTrap(trap: KnownTrap, body: string): TrapHit[] {
  if (!trap.enabled || !body) return [];
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
  drafts: readonly { id: string; title: string; status: string; body: string }[],
): TrapScanResult[] {
  const results: TrapScanResult[] = [];
  for (const trap of traps) {
    if (!trap.enabled) continue;
    const rows: TrapScanRow[] = [];
    let total = 0;
    for (const d of drafts) {
      const hits = matchTrap(trap, d.body ?? "");
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
