/**
 * Current verified statutory figures — the authoritative source of truth the
 * generators use to REPLACE stale numbers.
 *
 * A refresh carried 2023/2024 minimum-wage and salary-threshold figures forward
 * as current because the "preserve accurate content" rule protected them and the
 * refresh path injected no reference facts. This file gives the generator the
 * current values (with effective dates) so it can overwrite superseded numbers,
 * and lets the freshness gate show the reviewer the correct value.
 *
 * Code-seeded for now (update a value = one-line change / PR). Can move to a
 * `current_facts` table + admin UI later without changing callers.
 *
 * IMPORTANT: keep these current. When the law changes, update the value AND the
 * effectiveDate. Stale entries here become stale entries on the site.
 */

export type CurrentFact = {
  id: string;
  /** Human label shown to the reviewer. */
  label: string;
  /** The authoritative current value, formatted for prose (e.g. "$17.00"). */
  value: string;
  /** Where it applies. */
  jurisdiction: string;
  /** ISO date the value took effect. */
  effectiveDate: string;
  /** Keywords used to match a draft/flag to this fact. */
  keywords: string[];
  /** Value denominator: "hour" | "week" | "year" | "". */
  unit?: string;
  /** Authority the value came from (statute/agency URL). */
  sourceUrl?: string;
  /** Who last verified it, and when (ISO), for the audit trail. */
  verifiedBy?: string;
  verifiedAt?: string;
  /**
   * Attorney must re-confirm by this ISO date. Past it the value is stale and
   * must force a fresh human check — never presented as verified. NY wage
   * thresholds change every Jan 1, so dated figures carry next Jan 1.
   */
  reVerifyBy?: string;
  /**
   * Litigated or otherwise uncertain (e.g. the federal $684 threshold). Never
   * auto-suggest or auto-write this value; the reviewer must Mark verified.
   */
  verifyOnly?: boolean;
  /**
   * Set when this figure is CALCULATED from another tracked fact rather than
   * independently sourced — e.g. an annual threshold is the weekly one × 52.
   *
   * A derived value is never independently stale: it is correct whenever its
   * source is correct. So it is exempt from re-verification, and the reviewer's
   * action on it is "recalculate", not "replace with a newly verified number".
   * recomputeDerived() re-evaluates it from the source, so editing the weekly
   * figure on /settings/current-facts moves the annual one with it instead of
   * leaving a second number to forget.
   */
  derived?: {
    /** id of the CurrentFact this is calculated from. */
    fromFactId: string;
    /** Multiplier applied to the source amount (52 for weekly → annual). */
    multiplier: number;
  };
  /**
   * Phrases that state the SUPERSEDED version of this fact. When one appears in
   * a draft, the sentence is wrong and a human has to reword it — a prose rule
   * can't be fixed by swapping a token the way a dollar figure can.
   *
   * Exists because "the NYSHRL applies to employers with four or more employees"
   * reads as a perfectly current sentence to a scanner that only compares
   * numbers, while telling a reader at a small employer they have no claim.
   */
  supersedes?: string[];
};

// Code-seeded fallback of CONFIRMED figures (as of Jan 1, 2026). The editable
// current_facts table (admin: /settings/current-facts) overrides this per tenant
// and is where future updates are maintained. Keep these current: when the law
// changes, update value + effectiveDate + reVerifyBy.
//
// NJ figures are the same ones the damages calculator uses (katz-melinger-cms
// app/lib/damages-rates.ts), both taken from NJDOL poster MW-570 (1/26). If one
// side changes, change the other.
export const CURRENT_FACTS: CurrentFact[] = [
  {
    id: "ny-min-wage-downstate-2026",
    label: "NY minimum wage (NYC, Long Island, Westchester)",
    value: "$17.00 per hour",
    jurisdiction: "New York City, Long Island, Westchester",
    effectiveDate: "2026-01-01",
    unit: "hour",
    reVerifyBy: "2027-01-01",
    keywords: [
      "minimum wage", "min wage", "hourly wage", "wage rate",
      "new york city", "nyc", "long island", "westchester",
    ],
  },
  {
    id: "ny-min-wage-upstate-2026",
    label: "NY minimum wage (rest of New York State)",
    value: "$16.00 per hour",
    jurisdiction: "Rest of New York State (outside NYC, Long Island, Westchester)",
    effectiveDate: "2026-01-01",
    unit: "hour",
    reVerifyBy: "2027-01-01",
    keywords: [
      "minimum wage", "min wage", "hourly wage", "wage rate",
      "upstate", "rest of new york", "rest of state",
    ],
  },
  // The four NY exempt-salary figures are tracked as FOUR facts, not one.
  // Downstate and upstate diverge, and each has a weekly and an annual form, so
  // a single field standing in for all of them means an "apply update" on one
  // silently rewrites the other three. Region separates them by keyword; week
  // vs year separates them by `unit` (see matchCurrentFact).
  {
    id: "ny-exempt-threshold-downstate-2026",
    label: "NY exempt salary threshold — downstate, weekly",
    value: "$1,275.00 per week",
    jurisdiction: "New York City and downstate counties (Nassau, Suffolk, Westchester)",
    effectiveDate: "2026-01-01",
    unit: "week",
    reVerifyBy: "2027-01-01",
    keywords: [
      "salary threshold", "exempt threshold", "salary basis", "exemption threshold",
      "executive exemption", "administrative exemption", "overtime exemption",
      "exempt salary", "salary level", "new york city", "nyc", "downstate",
      "nassau", "suffolk", "westchester", "long island",
    ],
  },
  {
    id: "ny-exempt-threshold-downstate-annual-2026",
    label: "NY exempt salary threshold — downstate, annual",
    value: "$66,300.00 per year",
    jurisdiction: "New York City and downstate counties (Nassau, Suffolk, Westchester)",
    effectiveDate: "2026-01-01",
    unit: "year",
    derived: { fromFactId: "ny-exempt-threshold-downstate-2026", multiplier: 52 },
    keywords: [
      "salary threshold", "exempt threshold", "salary basis", "exemption threshold",
      "executive exemption", "administrative exemption", "overtime exemption",
      "exempt salary", "salary level", "new york city", "nyc", "downstate",
      "nassau", "suffolk", "westchester", "long island",
    ],
  },
  {
    id: "ny-exempt-threshold-upstate-2026",
    label: "NY exempt salary threshold — rest of state, weekly",
    value: "$1,199.10 per week",
    jurisdiction: "Rest of New York State (outside NYC, Nassau, Suffolk, Westchester)",
    effectiveDate: "2026-01-01",
    unit: "week",
    reVerifyBy: "2027-01-01",
    keywords: [
      "salary threshold", "exempt threshold", "salary basis", "exemption threshold",
      "executive exemption", "administrative exemption", "overtime exemption",
      "exempt salary", "salary level",
      "rest of new york", "rest of the state", "rest of state", "upstate",
      "outside new york city", "remainder of the state",
    ],
  },
  {
    id: "ny-exempt-threshold-upstate-annual-2026",
    label: "NY exempt salary threshold — rest of state, annual",
    value: "$62,353.20 per year",
    jurisdiction: "Rest of New York State (outside NYC, Nassau, Suffolk, Westchester)",
    effectiveDate: "2026-01-01",
    unit: "year",
    derived: { fromFactId: "ny-exempt-threshold-upstate-2026", multiplier: 52 },
    keywords: [
      "salary threshold", "exempt threshold", "salary basis", "exemption threshold",
      "executive exemption", "administrative exemption", "overtime exemption",
      "exempt salary", "salary level",
      "rest of new york", "rest of the state", "rest of state", "upstate",
      "outside new york city", "remainder of the state",
    ],
  },
  // NJ keywords deliberately omit the bare "nj" abbreviation: keyword matching is
  // substring-based, and "nj" is inside "injury", "injunction" and "conjunction",
  // which would pull New Jersey wage figures into unrelated drafts.
  {
    id: "nj-min-wage-2026",
    label: "NJ minimum wage (most employers)",
    value: "$15.92 per hour",
    jurisdiction: "New Jersey (employers with 6 or more employees)",
    effectiveDate: "2026-01-01",
    unit: "hour",
    sourceUrl: "https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf",
    reVerifyBy: "2027-01-01",
    keywords: [
      "minimum wage", "min wage", "hourly wage", "wage rate",
      "new jersey", "n.j.",
    ],
  },
  {
    // No generic "minimum wage" keywords here on purpose. Both NJ facts would
    // then tie on a plain "New Jersey minimum wage" sentence and matchCurrentFact
    // would return nothing; most employers are the default case, so the sentence
    // has to actually say "seasonal"/"small" to select this lower rate.
    id: "nj-min-wage-small-employer-2026",
    label: "NJ minimum wage (seasonal and small employers)",
    value: "$15.23 per hour",
    jurisdiction: "New Jersey (seasonal employers and employers with fewer than 6 employees)",
    effectiveDate: "2026-01-01",
    unit: "hour",
    sourceUrl: "https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf",
    reVerifyBy: "2027-01-01",
    keywords: [
      "new jersey", "n.j.",
      "seasonal employer", "seasonal employers", "small employer", "small employers",
      "fewer than 6 employees", "fewer than six employees",
    ],
  },
  {
    id: "nj-tipped-cash-wage-2026",
    label: "NJ cash wage for tipped workers",
    value: "$6.05 per hour",
    jurisdiction: "New Jersey (maximum tip credit $9.87 for most employers)",
    effectiveDate: "2026-01-01",
    unit: "hour",
    sourceUrl: "https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf",
    reVerifyBy: "2027-01-01",
    keywords: [
      "tipped", "tip credit", "cash wage", "tipped minimum wage", "server",
      "new jersey", "n.j.",
    ],
  },
  {
    id: "federal-min-wage",
    label: "Federal minimum wage (FLSA)",
    value: "$7.25 per hour",
    jurisdiction: "United States (federal)",
    effectiveDate: "2009-07-24",
    unit: "hour",
    reVerifyBy: "2027-01-01",
    keywords: ["federal minimum wage", "flsa minimum wage"],
  },
  {
    // Litigated at the federal level — value is known but must be attorney-
    // confirmed before use, never auto-written. See verifyOnly.
    id: "federal-exempt-threshold",
    label: "Federal exempt salary threshold (FLSA white-collar)",
    value: "$684.00 per week",
    jurisdiction: "United States (federal)",
    effectiveDate: "2020-01-01",
    unit: "week",
    verifyOnly: true,
    keywords: [
      "federal salary threshold", "federal exempt", "flsa salary threshold",
      "white collar exemption", "federal overtime threshold",
    ],
  },
  {
    id: "ny-wage-lookback",
    label: "NY wage-claim statute of limitations (lookback)",
    value: "6 years",
    jurisdiction: "New York",
    effectiveDate: "",
    unit: "",
    // "new york" is here to outscore the NJ lookback on a New York sentence.
    // Without it the two tie on the shared keywords and neither is suggested.
    keywords: [
      "statute of limitations", "wage lookback", "six-year", "six years", "6 years",
      "new york", "n.y.",
    ],
  },
  {
    id: "nj-wage-lookback",
    label: "NJ wage-claim statute of limitations (lookback)",
    value: "6 years",
    jurisdiction: "New Jersey",
    effectiveDate: "2019-08-06",
    unit: "",
    sourceUrl: "https://www.njleg.state.nj.us/bill-search/2018/A2903",
    keywords: [
      "statute of limitations", "wage lookback", "six-year", "six years", "6 years",
      "new jersey", "n.j.", "wage theft act",
    ],
  },
  // Employer-size coverage thresholds. Tracked because the superseded
  // "four or more employees" rule was still being written into drafts, which
  // tells a reader at a small employer they have no claim when they do.
  {
    id: "nyshrl-employer-size",
    label: "NYSHRL employer-size threshold",
    value: "all employers regardless of size",
    jurisdiction: "New York State",
    effectiveDate: "2020-02-08",
    unit: "",
    sourceUrl: "https://www.nysenate.gov/legislation/bills/2019/S6577",
    keywords: [
      "nyshrl", "new york state human rights law", "human rights law",
      "employer size", "four or more employees", "4 or more employees",
      "regardless of size", "small employer",
    ],
    supersedes: [
      "four or more employees", "4 or more employees",
      "at least four employees", "fewer than four employees",
    ],
  },
  {
    id: "nychrl-employer-size-harassment",
    label: "NYCHRL employer-size threshold — sexual/gender-based harassment",
    value: "employers of any size",
    jurisdiction:
      "New York City (harassment claims only; the four-or-more threshold still applies to other NYCHRL protections)",
    effectiveDate: "2019-04-01",
    unit: "",
    sourceUrl: "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=3345349",
    keywords: [
      "nychrl", "new york city human rights law",
      "sexual harassment", "gender-based harassment", "gender based harassment",
      "employer size", "four or more employees", "4 or more employees",
      "any size", "regardless of size",
    ],
    supersedes: [
      "four or more employees", "4 or more employees",
      "at least four employees", "fewer than four employees",
    ],
  },
];

/** Numeric amount in a formatted value string. "$1,275.00 per week" → 1275. */
function amountOf(value: string): number | null {
  const m = (value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

/** Format a number the way tracked money values are written. */
function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const UNIT_SUFFIX: Record<string, string> = {
  hour: " per hour",
  week: " per week",
  year: " per year",
};

/**
 * Recompute every derived fact from its source, so an annual figure can never
 * drift from the weekly one it is calculated from. Facts whose source is
 * missing or non-numeric are returned unchanged rather than blanked — a stale
 * literal is still better than no value at the freshness gate.
 *
 * Call this after loading facts from any source (code list or DB) so the value
 * a reviewer sees is always source × multiplier.
 */
export function recomputeDerived(facts: CurrentFact[]): CurrentFact[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return facts.map((f) => {
    if (!f.derived) return f;
    const source = byId.get(f.derived.fromFactId);
    const base = source ? amountOf(source.value) : null;
    if (base === null || !Number.isFinite(f.derived.multiplier)) return f;
    const value = formatMoney(base * f.derived.multiplier) + (UNIT_SUFFIX[f.unit ?? ""] ?? "");
    return value === f.value ? f : { ...f, value };
  });
}

const norm = (s: string) => s.toLowerCase();

/**
 * True when a fact is past its re-verify-by date and must be re-confirmed by a
 * human before it can be presented as current. NY thresholds change every Jan 1,
 * so a dated figure silently goes stale without this check.
 */
export function needsReVerification(fact: CurrentFact, asOf: Date = new Date()): boolean {
  // A derived value is never independently stale — it is correct whenever its
  // source is correct, and the source carries its own re-verify date.
  if (fact.derived) return false;
  if (!fact.reVerifyBy) return false;
  const due = new Date(fact.reVerifyBy);
  if (Number.isNaN(due.getTime())) return false;
  return asOf.getTime() > due.getTime();
}

/**
 * Facts safe for the generator to auto-write as authoritative: a real value,
 * not litigated (verifyOnly), and not past re-verification. Litigated or stale
 * figures still surface to the reviewer, but must never be force-written.
 */
export function autoWritableFacts(facts: CurrentFact[], asOf: Date = new Date()): CurrentFact[] {
  return facts.filter((f) => f.value.trim() && !f.verifyOnly && !needsReVerification(f, asOf));
}

/**
 * Facts whose keywords appear in the given text. `facts` defaults to the
 * code-seeded list; the DB-backed store (lib/current-facts-store.ts) passes the
 * live, staff-edited list instead.
 */
export function relevantFacts(text: string, facts: CurrentFact[] = CURRENT_FACTS): CurrentFact[] {
  const hay = norm(text ?? "");
  return facts.filter((f) => f.keywords.some((k) => hay.includes(norm(k))));
}

/**
 * Prompt block of authoritative current figures. Pass the draft body / keywords
 * to scope it to relevant facts; with no scope, includes all. `facts` defaults
 * to the code-seeded list; callers with the live list pass it explicitly.
 */
export function renderCurrentFactsBlock(
  scopeText?: string,
  facts: CurrentFact[] = CURRENT_FACTS,
): string {
  const inScope = scopeText ? relevantFacts(scopeText, facts) : facts;
  // Only auto-instruct the generator with confirmed, non-stale, non-litigated
  // values. A litigated ($684) or expired figure must be human-verified, not
  // force-written into a draft.
  const scoped = autoWritableFacts(inScope);
  if (scoped.length === 0) return "";
  const lines = scoped.map(
    (f) => `- ${f.label}: ${f.value} (${f.jurisdiction}), effective ${f.effectiveDate}.`,
  );
  return [
    "CURRENT VERIFIED FIGURES (authoritative). Use these EXACT values where the",
    "topic calls for them. If the page states a different or older figure for the",
    "same item, REPLACE it with the value below. Never present a superseded figure",
    "as current, and never invent a figure that is not listed here.",
    ...lines,
  ].join("\n");
}

/**
 * Given a flagged token from the freshness check (e.g. a dollar amount or a
 * "minimum wage" mention) plus its sentence, return the matching current fact so
 * the reviewer sees the correct value. Matches on the sentence's keywords, not
 * the number, so an outdated "$16.50" still maps to the right fact.
 */
export function matchCurrentFact(
  flag: { match?: string; sentence?: string; occurrence?: number },
  facts: CurrentFact[] = CURRENT_FACTS,
): CurrentFact | null {
  const sentence = flag?.sentence ?? "";
  const hay = norm(`${sentence} ${flag?.match ?? ""}`);
  if (!hay.trim()) return null;

  // Time unit wins before keyword scoring. Two figures in ONE sentence ("at
  // least $1,275.00 per week, which is $66,300.00 a year") share an identical
  // sentence and therefore an identical keyword score — only the words right
  // after each token say which fact it is. Without this, one Apply rewrites
  // both, which is how "$1,275.00 a year" got into a live draft.
  const unit = unitNear(sentence, flag?.match ?? "", flag?.occurrence ?? 0);
  const pool =
    unit === null
      ? facts
      : (() => {
          const scoped = facts.filter((f) => (f.unit ?? "") === unit);
          // Nothing declares that unit — fall back rather than match nothing.
          return scoped.length > 0 ? scoped : facts;
        })();

  // Prefer the fact whose matched keywords are the most specific. Score by total
  // matched-keyword length, so "federal minimum wage" (a jurisdiction-specific
  // keyword) outranks the generic "minimum wage" instead of tying with it.
  let bestScore = 0;
  let winners: CurrentFact[] = [];
  for (const f of pool) {
    const matched = f.keywords.filter((k) => hay.includes(norm(k)));
    if (matched.length === 0) continue;
    const score = matched.reduce((sum, k) => sum + k.length, 0);
    if (score > bestScore) {
      bestScore = score;
      winners = [f];
    } else if (score === bestScore) {
      winners.push(f);
    }
  }
  // Ambiguous — multiple facts tie at the top (e.g. NYC $17 vs rest-of-state $16
  // minimum wage, when the sentence gives no jurisdiction cue). Don't guess a
  // value the reviewer might wrongly trust; surface the flag with no suggestion.
  if (winners.length !== 1) return null;
  return winners[0];
}

/** Phrases that name a value's denominator, longest first so "per year" beats "year". */
const UNIT_CUES: { unit: string; cues: string[] }[] = [
  { unit: "hour", cues: ["per hour", "an hour", "each hour", "hourly", "/hour", "/hr"] },
  { unit: "week", cues: ["per week", "a week", "each week", "weekly", "/week", "/wk"] },
  {
    unit: "year",
    cues: ["per year", "a year", "each year", "per annum", "annually", "annualized", "/year", "/yr"],
  },
];

/**
 * The time unit a specific figure is expressed in, read from the words that
 * follow it. Scoped to the text immediately after the token so a second figure
 * later in the same sentence can't claim the first one's unit.
 *
 * Returns null when the token isn't found or no cue follows it — the caller
 * then falls back to keyword scoring across all facts.
 */
export function unitNear(sentence: string, match: string, occurrence = 0): string | null {
  const hay = norm(sentence);
  const needle = norm(match);
  if (!needle) return null;
  // Walk to the Nth occurrence — repeated identical tokens in one sentence are
  // different facts, and only the words after each one say which.
  let at = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    at = hay.indexOf(needle, at + (i === 0 ? 0 : needle.length));
    if (at < 0) return null;
  }
  if (at < 0) return null;
  // Look only at what follows this figure, up to the next figure or ~32 chars.
  const after = hay.slice(at + needle.length, at + needle.length + 32);
  const nextFigure = after.search(/\$\s?\d/);
  const window = nextFigure >= 0 ? after.slice(0, nextFigure) : after;
  for (const { unit, cues } of UNIT_CUES) {
    if (cues.some((c) => window.includes(c))) return unit;
  }
  return null;
}
