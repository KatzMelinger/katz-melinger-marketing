/**
 * Rule 3, extended — validate a value against its region and effective date
 * (spec 3.13), and flag two different values for the same metric.
 *
 * Two live examples from Diana's spec motivate this:
 *   - "As of 2025, the minimum wage is $17.00 per hour" — the FIGURE is
 *     right, but $17.00 didn't take effect until January 1, 2026, so the
 *     DATE is wrong. Rule 3's citation-based check never catches this: the
 *     sentence names no citation, and $17.00 is not itself a wrong number.
 *   - "$1,275.00 per week ... in the rest of the state" — the figure is
 *     wrong for the region it's paired with (should be $1,199.10). Same
 *     problem: no citation to retrieve and compare against.
 *
 * Both need a value/region/date-aware comparison against the maintained
 * knowledge base (lib/legal-knowledge-base.ts, spec 3.1), not a citation
 * fetch. A third check here needs no knowledge base at all: if a draft states
 * two different dollar figures for what reads as the same metric and region,
 * that is self-evidently a contradiction regardless of which one (if either)
 * is actually current.
 */

import { splitSentences } from "./legal-classifier";
import { getThresholds, type KbThresholdEntry, type LegalJurisdiction } from "./legal-knowledge-base";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";

type ValueMention = {
  sentence: string;
  index: number;
  amount: number;
  unit: KbThresholdEntry["unit"];
  jurisdiction: LegalJurisdiction | null;
  /** A region signal found IN THE SAME SENTENCE, or null if unstated. */
  region: string | null;
  /** A year named in the sentence ("as of 2025", "effective 2026"), or null. */
  statedYear: number | null;
};

// Both English and Spanish unit/date patterns are tested unconditionally on
// every sentence (spec 5.2) — same approach as lib/social-compliance.ts's
// `reEs`: cheaper and safer than detecting language first, since a wrong
// language guess could only ever suppress a real check, never add one.
const AMOUNT_RE =
  /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:per|\/|an?|por)\s*(hour|week|year|hr|wk|yr|hora|semana|a[nñ]o)\b/gi;

const UNIT_MAP: Record<string, KbThresholdEntry["unit"]> = {
  hour: "usd_per_hour",
  hr: "usd_per_hour",
  hora: "usd_per_hour",
  week: "usd_per_week",
  wk: "usd_per_week",
  semana: "usd_per_week",
  year: "usd_per_year",
  yr: "usd_per_year",
  "año": "usd_per_year",
  "ano": "usd_per_year",
};

const YEAR_RE =
  /\b(?:as of|in|since|effective(?: as of)?(?: \w+ \d{1,2},?)?|a partir de|desde|vigente(?: a partir de| desde)?|con vigencia desde)\s+(?:el\s+)?(\d{4})\b/i;

const DOWNSTATE_RE =
  /\bNew York City\b|\bNYC\b|\bLong Island\b|\bWestchester\b|\bdownstate\b|\bciudad de Nueva York\b/i;
const REMAINDER_RE =
  /\brest of (?:the )?(?:state|New York)\b|\bremainder of (?:the )?state\b|\bupstate\b|\bresto del estado\b/i;

function detectJurisdiction(sentence: string): LegalJurisdiction | null {
  if (/\bNew Jersey\b|\bNJ\b|\bNueva Jersey\b/i.test(sentence)) return "NJ";
  if (/\bNew York\b|\bNY\b|\bNYC\b|\bNueva York\b/i.test(sentence)) return "NY";
  if (/\bfederal\b|\bFLSA\b/i.test(sentence)) return "federal";
  return null;
}

function detectRegion(sentence: string): string | null {
  if (DOWNSTATE_RE.test(sentence)) return "downstate";
  if (REMAINDER_RE.test(sentence)) return "remainder_of_state";
  return null;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** The year from a "YYYY-MM-DD" string, read directly rather than through
 *  `new Date(...).getFullYear()` — that constructor parses a date-only string
 *  as UTC midnight, but getFullYear() reads it back in the LOCAL timezone, so
 *  an effective_date of "2026-01-01" silently becomes 2025 on any machine
 *  west of UTC. Caught by scripts/tmp-test-legal-3x.ts against the spec's own
 *  "$17.00 as of 2025" example, which this exact bug made pass uncaught. */
function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** Every dollar-per-unit figure in the body, with whatever region/date/
 *  jurisdiction context appears IN THE SAME SENTENCE — spec 3.13 is explicit
 *  that the check is against what's "named in the sentence", not the draft
 *  as a whole, so a correct figure elsewhere can't paper over a wrong pairing
 *  here. */
export function extractValueMentions(body: string): ValueMention[] {
  if (!body?.trim()) return [];
  const mentions: ValueMention[] = [];
  for (const s of splitSentences(body)) {
    for (const m of s.text.matchAll(AMOUNT_RE)) {
      const amount = Number(m[1].replace(/,/g, ""));
      const unit = UNIT_MAP[m[2].toLowerCase()];
      if (!Number.isFinite(amount) || !unit) continue;
      const yearMatch = s.text.match(YEAR_RE);
      mentions.push({
        sentence: s.text,
        index: s.index + (m.index ?? 0),
        amount,
        unit,
        jurisdiction: detectJurisdiction(s.text),
        region: detectRegion(s.text),
        statedYear: yearMatch ? Number(yearMatch[1]) : null,
      });
    }
  }
  return mentions;
}

function mentionFinding(args: {
  ruleId: string;
  severity: "critical" | "important";
  title: string;
  detail: string;
  fix: string;
  mention: ValueMention;
  jurisdiction: LegalJurisdiction | null;
}): NormalizedFinding {
  return {
    fingerprint: fingerprintFinding("legal", args.ruleId, args.mention.sentence),
    source: "legal",
    ruleId: args.ruleId,
    severity: args.severity,
    title: args.title,
    detail: args.detail,
    excerpt: args.mention.sentence,
    fix: args.fix,
    sourceChecked: null,
    jurisdiction: args.jurisdiction,
  };
}

/** Compare one mention against the knowledge base's entries for its
 *  jurisdiction + unit (optionally narrowed to the region the sentence
 *  named). Returns a finding only when there's a real basis to flag —
 *  ambiguous or unconfirmed cases (no matching KB entry, no date to compare)
 *  are left alone rather than guessed at, per 3.5's "ambiguous defaults to
 *  human, never auto-approve" — but never-flagging on ambiguity here means
 *  never-AUTO-CLEARING either: this function only ever adds findings, never
 *  removes the claim from consideration. */
function checkAgainstKnowledgeBase(
  mention: ValueMention,
  allThresholds: KbThresholdEntry[],
): NormalizedFinding | null {
  if (!mention.jurisdiction) return null;
  const candidates = allThresholds.filter(
    (t) => t.jurisdiction === mention.jurisdiction && t.unit === mention.unit,
  );
  const scoped = mention.region ? candidates.filter((t) => t.region === mention.region) : candidates;
  if (scoped.length === 0) return null; // nothing in the KB to compare against yet

  for (const entry of scoped) {
    if (closeEnough(mention.amount, entry.currentValue)) {
      if (mention.statedYear && entry.effectiveDate) {
        const effYear = yearOf(entry.effectiveDate);
        if (mention.statedYear < effYear) {
          return mentionFinding({
            ruleId: "value_date_mismatch",
            severity: "critical",
            title: `Figure did not take effect until ${entry.effectiveDate}, not ${mention.statedYear}`,
            detail: `"$${mention.amount.toFixed(2)}" matches the CURRENT ${entry.label} (effective ${entry.effectiveDate}), but this sentence dates it to ${mention.statedYear} — before it took effect.`,
            fix: `State the correct effective date (${entry.effectiveDate}), or use the figure that was actually in effect in ${mention.statedYear}${entry.priorValue !== null ? ` ($${entry.priorValue.toFixed(2)})` : ""}.`,
            mention,
            jurisdiction: mention.jurisdiction,
          });
        }
      }
      return null; // current figure, no date contradiction
    }
    if (entry.priorValue !== null && closeEnough(mention.amount, entry.priorValue)) {
      if (mention.statedYear && entry.effectiveDate) {
        const effYear = yearOf(entry.effectiveDate);
        if (mention.statedYear >= effYear) {
          return mentionFinding({
            ruleId: "value_date_mismatch",
            severity: "critical",
            title: `Figure was superseded on ${entry.effectiveDate}`,
            detail: `"$${mention.amount.toFixed(2)}" was ${entry.label}'s rate before ${entry.effectiveDate}, but this sentence dates it to ${mention.statedYear} — the current figure is $${entry.currentValue.toFixed(2)}.`,
            fix: `Use the current figure ($${entry.currentValue.toFixed(2)}, effective ${entry.effectiveDate}) or correct the date this rate applied to.`,
            mention,
            jurisdiction: mention.jurisdiction,
          });
        }
      }
      return null; // correctly framed as the historical rate for a past date
    }
  }

  // Matches neither the current nor the prior figure for a region the
  // sentence itself named (or the KB's only region, if unstated) — the
  // highest-confidence miss: a region-scoped fact and a value that doesn't
  // belong to it.
  const best = scoped[0];
  return mentionFinding({
    ruleId: "value_region_mismatch",
    severity: "critical",
    title: `Figure doesn't match ${best.label}`,
    detail: `"$${mention.amount.toFixed(2)}" doesn't match the current ($${best.currentValue.toFixed(2)}${best.effectiveDate ? `, effective ${best.effectiveDate}` : ""})${best.priorValue !== null ? ` or prior ($${best.priorValue.toFixed(2)})` : ""} figure for ${best.label}.`,
    fix: `Correct the figure, or confirm the region — this may belong to a different region's rate.`,
    mention,
    jurisdiction: mention.jurisdiction,
  });
}

/** Two different values for what reads as the same metric, region, and
 *  jurisdiction, within one draft — a contradiction that needs no knowledge
 *  base to catch, since both can't be true at once. */
function findInternalConflicts(mentions: ValueMention[]): NormalizedFinding[] {
  const byKey = new Map<string, ValueMention[]>();
  for (const m of mentions) {
    if (!m.jurisdiction) continue;
    const key = `${m.jurisdiction}|${m.unit}|${m.region ?? "unspecified"}`;
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  const findings: NormalizedFinding[] = [];
  for (const list of byKey.values()) {
    const distinct = new Set(list.map((m) => m.amount));
    if (distinct.size < 2) continue;
    for (const m of list) {
      const others = [...distinct].filter((a) => a !== m.amount);
      findings.push(
        mentionFinding({
          ruleId: "value_internal_conflict",
          severity: "critical",
          title: `Two different figures given for the same metric in this draft`,
          detail: `This sentence says $${m.amount.toFixed(2)}; elsewhere the draft says $${others.map((a) => a.toFixed(2)).join(" / $")} for what reads as the same figure. Both can't be current.`,
          fix: "Pick the correct figure and use it consistently throughout the draft.",
          mention: m,
          jurisdiction: m.jurisdiction,
        }),
      );
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Employment-law CONSTANTS: deadlines and coverage thresholds (Diana 2.2)     */
/* -------------------------------------------------------------------------- */

/**
 * The money check above only ever saw "$X per hour/week/year". Diana's
 * five-draft test found the same two errors again and again, and neither is a
 * dollar figure:
 *
 *   - "the NYSHRL administrative deadline is one year"  (it is 3 years)
 *   - "the NYSHRL applies to employers with four or more employees"
 *     (it applies to all employers)
 *
 * So a deadline stated in days or years, and a coverage threshold stated in
 * employees, are extracted and compared the same way a wage figure is. The
 * difference is how an entry is SELECTED: a jurisdiction has exactly one
 * minimum wage per region, but several deadlines, so these entries carry
 * match_keywords and a mention only compares against an entry whose keywords
 * all appear in the same sentence.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, eighteen: 18,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};

function toNumber(raw: string): number | null {
  const word = NUMBER_WORDS[raw.toLowerCase()];
  if (word !== undefined) return word;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const NUM = "(?:[\\d,]{1,7}|" + Object.keys(NUMBER_WORDS).join("|") + ")";

/** "3 years", "one year", "300 days", "180 calendar days". */
const DURATION_RE = new RegExp(
  "\\b(" + NUM + ")\\s+(?:calendar\\s+|business\\s+|work(?:ing)?\\s+)?(day|days|month|months|year|years)\\b",
  "gi",
);

/** "four or more employees", "at least 15 employees", "20+ employees". */
const COVERAGE_RE = new RegExp(
  "\\b(" + NUM + ")\\s*\\+?\\s*(?:or\\s+more\\s+|or\\s+fewer\\s+)?employees\\b" +
    "|\\b(?:at\\s+least|fewer\\s+than|more\\s+than|minimum\\s+of|no\\s+fewer\\s+than)\\s+(" + NUM + ")\\s+employees\\b",
  "gi",
);

/**
 * Coverage stated in words rather than a number: "all employers", "any size",
 * "regardless of size". Recorded as 1, which is how the knowledge base stores
 * an all-employers rule, so one comparison serves both phrasings.
 */
const COVERAGE_ANY_SIZE_RE =
  /\b(?:all employers|any size|regardless of (?:their )?size|no matter (?:the|their) size|every employer)\b/i;

type ConstantMention = {
  sentence: string;
  index: number;
  value: number;
  unit: "days" | "years" | "employees";
  /** The exact text matched, so a fix can tell the model what to replace. */
  matchedText: string;
};

export function extractConstantMentions(body: string): ConstantMention[] {
  if (!body?.trim()) return [];
  const out: ConstantMention[] = [];
  for (const s of splitSentences(body)) {
    for (const m of s.text.matchAll(DURATION_RE)) {
      const value = toNumber(m[1]);
      if (value === null) continue;
      const word = m[2].toLowerCase();
      // Months normalise to days so "18 months" and "540 days" compare against
      // the same entry. Years stay years: every deadline the knowledge base
      // records in years is written that way in copy too.
      const unit = word.startsWith("year") ? "years" : "days";
      const scaled = word.startsWith("month") ? value * 30 : value;
      out.push({
        sentence: s.text,
        index: s.index + (m.index ?? 0),
        value: scaled,
        unit,
        matchedText: m[0],
      });
    }
    for (const m of s.text.matchAll(COVERAGE_RE)) {
      const value = toNumber(m[1] ?? m[2] ?? "");
      if (value === null) continue;
      out.push({
        sentence: s.text,
        index: s.index + (m.index ?? 0),
        value,
        unit: "employees",
        matchedText: m[0],
      });
    }
    const anySize = s.text.match(COVERAGE_ANY_SIZE_RE);
    if (anySize) {
      out.push({
        sentence: s.text,
        index: s.index + (anySize.index ?? 0),
        value: 1,
        unit: "employees",
        matchedText: anySize[0],
      });
    }
  }
  return out;
}

/** Does every one of an entry's keyword alternations appear in the sentence? */
function keywordsMatch(entry: KbThresholdEntry, sentence: string): boolean {
  if (entry.matchKeywords.length === 0) return false;
  const hay = sentence.toLowerCase();
  return entry.matchKeywords.every((group) =>
    group.split("|").some((term) => {
      const t = term.trim().toLowerCase();
      return t.length > 0 && hay.includes(t);
    }),
  );
}

/** How a value reads back to a reviewer, in its own unit. */
function formatConstant(value: number, unit: ConstantMention["unit"]): string {
  if (unit === "employees") {
    return value <= 1 ? "all employers (any size)" : `${value} or more employees`;
  }
  if (unit === "years") return `${value} ${value === 1 ? "year" : "years"}`;
  return `${value} days`;
}

function checkConstantAgainstKnowledgeBase(
  mention: ConstantMention,
  thresholds: KbThresholdEntry[],
): NormalizedFinding | null {
  // Only entries in the same unit whose keywords the sentence actually carries.
  // Most specific wins when several qualify, so a sentence naming both the
  // statute and the deadline beats one matched on the statute alone.
  const entry = thresholds
    .filter((t) => t.unit === mention.unit && keywordsMatch(t, mention.sentence))
    .sort((a, b) => b.matchKeywords.length - a.matchKeywords.length)[0];
  if (!entry) return null; // nothing in the knowledge base speaks to this sentence
  if (mention.value === entry.currentValue) return null; // correct

  const current = formatConstant(entry.currentValue, mention.unit);
  const stated = formatConstant(mention.value, mention.unit);
  const since = entry.effectiveDate ? ` since ${entry.effectiveDate}` : "";
  const wasRight = entry.priorValue !== null && mention.value === entry.priorValue;

  return {
    fingerprint: fingerprintFinding("legal", "constant_mismatch", mention.sentence),
    source: "legal",
    ruleId: "constant_mismatch",
    // A named legal constant that disagrees with the maintained knowledge base
    // is a definite error, not a prompt to go and think about it.
    severity: "critical",
    title: `${entry.label} is ${current}, not ${stated}`,
    detail: wasRight
      ? `This says ${stated}, which was right until it changed. The current value is ${current}${since}.` +
        (entry.sourceUrl ? ` Source: ${entry.sourceUrl}` : "")
      : `This says ${stated}; the current value is ${current}${since}.` +
        (entry.notes ? ` ${entry.notes}` : ""),
    excerpt: mention.sentence,
    // A literal instruction, so "Apply fix" swaps the value in (Diana 2.2)
    // instead of handing a reviewer something to go and look up.
    //
    // An all-employers rule is phrased as an instruction rather than a string
    // swap: dropping "all employers (any size)" into the slot a threshold
    // occupied produces "applies to employers with all employers (any size)".
    // The other direction is a clean substitution and stays one.
    fix:
      mention.unit === "employees" && entry.currentValue <= 1
        ? `Remove the "${mention.matchedText}" threshold and say the law applies to ALL employers regardless of size. Change nothing else in the sentence.`
        : `Replace "${mention.matchedText}" with "${current}". Change nothing else in the sentence.`,
    sourceChecked: entry.sourceUrl,
    jurisdiction: entry.jurisdiction,
  };
}

/** Both checks, pure and DB-free — split out from checkValuesAgainstKnowledgeBase
 *  so it's directly testable against a fixture threshold list. */
export function checkValuesAgainst(
  body: string,
  thresholds: KbThresholdEntry[],
): NormalizedFinding[] {
  const mentions = extractValueMentions(body);
  const constants = thresholds.length
    ? extractConstantMentions(body)
        .map((m) => checkConstantAgainstKnowledgeBase(m, thresholds))
        .filter((f): f is NormalizedFinding => f !== null)
    : [];
  if (mentions.length === 0) return dedupe(constants);

  const kbFindings = thresholds.length
    ? mentions
        .map((m) => checkAgainstKnowledgeBase(m, thresholds))
        .filter((f): f is NormalizedFinding => f !== null)
    : [];
  const conflictFindings = findInternalConflicts(mentions);

  // A mention already flagged by the KB check needn't also be flagged as an
  // internal conflict — dedupe by fingerprint, KB findings winning (they name
  // the actual correct figure, which is more useful than "these disagree").
  const seen = new Set(kbFindings.map((f) => f.fingerprint));
  return dedupe([
    ...kbFindings,
    ...conflictFindings.filter((f) => !seen.has(f.fingerprint)),
    ...constants,
  ]);
}

/** One finding per fingerprint. The same wrong figure written twice in one
 *  sentence is one error a reviewer fixes once. */
function dedupe(findings: NormalizedFinding[]): NormalizedFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => (seen.has(f.fingerprint) ? false : (seen.add(f.fingerprint), true)));
}

/** Run both checks over a draft body, reading the knowledge base live. A read
 *  failure degrades to skipping the KB comparison, not throwing — the
 *  internal-conflict check still runs regardless, since it needs no KB. */
export async function checkValuesAgainstKnowledgeBase(
  body: string,
  tenantId?: string,
): Promise<NormalizedFinding[]> {
  let thresholds: KbThresholdEntry[] = [];
  try {
    thresholds = await getThresholds(tenantId);
  } catch (e) {
    console.warn("[legal-value-check] knowledge base read failed:", e);
  }
  return checkValuesAgainst(body, thresholds);
}
