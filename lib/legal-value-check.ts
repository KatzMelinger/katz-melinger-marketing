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

/** Both checks, pure and DB-free — split out from checkValuesAgainstKnowledgeBase
 *  so it's directly testable against a fixture threshold list. */
export function checkValuesAgainst(
  body: string,
  thresholds: KbThresholdEntry[],
): NormalizedFinding[] {
  const mentions = extractValueMentions(body);
  if (mentions.length === 0) return [];

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
  return [...kbFindings, ...conflictFindings.filter((f) => !seen.has(f.fingerprint))];
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
