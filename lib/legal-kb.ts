/**
 * The four rule classes over the legal knowledge base (Diana item 11, stage 2).
 *
 *   R1  wrong authority or forum
 *   R2  missing qualifier or overbroad
 *   R3  fact and citation validation — values, deadlines, thresholds, sections
 *   R4  completeness
 *
 * Stage 1 was the trap matcher (lib/trap-gate.ts): patterns that have been
 * wrong before. This is the half that knows what is RIGHT, so it can catch an
 * error nobody has made yet — the Article 6 citation and the $1,199.10 figure
 * from the Unpaid Wages review are both first-time errors no trap would have
 * had a pattern for.
 *
 * DETERMINISTIC, AND THAT IS THE POINT
 *
 * Not one of these four asks a model anything. Every check is a lookup against
 * a row an attorney can read and correct. A model asked "is Article 6 the right
 * cite for the overtime rule" answers confidently either way and leaves nothing
 * to audit; a row saying the canonical citation is 12 NYCRR 142-2.2 can be
 * disagreed with in writing.
 *
 * That also means it costs nothing to run, so it runs on every approval rather
 * than behind the LEGAL_ACCURACY flag that meters the per-claim model calls.
 *
 * SCOPE, HONESTLY
 *
 * These are the lookupable half of Diana's spec. Interpretation — whether a
 * claim is overbroad in context, whether an omission actually misleads — still
 * routes to a person through lib/legal-verify.ts. An entry that cannot be
 * checked by comparing text to a stored value does not belong in the base.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { CURRENT_FACTS, type CurrentFact } from "./current-facts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type KbDerivation = {
  formula: string;
  fromFactId: string;
  multiplier: number;
  /** The unit the source fact is in ("hour"), so the product reads correctly. */
  basis?: string;
};

export type KbEntry = {
  id: string;
  practiceArea: string;
  claimType: string;
  jurisdiction: string;
  topic: string;
  label: string;
  matchKeywords: string[];
  enforcementPath: string | null;
  forum: string | null;
  filingDeadline: string | null;
  canonicalCitation: string | null;
  citationSays: string | null;
  wrongCitations: string[];
  requiredQualifiers: string[];
  currentValue: string | null;
  valueUnit: string | null;
  derivation: KbDerivation | null;
  neverPair: { a: string; b: string; why?: string }[];
  requiredCoverage: string[];
  version: number;
  effectiveFrom: string | null;
  sourceUrl: string | null;
};

function rowToEntry(r: any): KbEntry {
  return {
    id: r.id,
    practiceArea: r.practice_area,
    claimType: r.claim_type,
    jurisdiction: r.jurisdiction,
    topic: r.topic,
    label: r.label,
    matchKeywords: Array.isArray(r.match_keywords) ? r.match_keywords : [],
    enforcementPath: r.enforcement_path ?? null,
    forum: r.forum ?? null,
    filingDeadline: r.filing_deadline ?? null,
    canonicalCitation: r.canonical_citation ?? null,
    citationSays: r.citation_says ?? null,
    wrongCitations: Array.isArray(r.wrong_citations) ? r.wrong_citations : [],
    requiredQualifiers: Array.isArray(r.required_qualifiers) ? r.required_qualifiers : [],
    currentValue: r.current_value ?? null,
    valueUnit: r.value_unit ?? null,
    derivation: (r.derivation as KbDerivation | null) ?? null,
    neverPair: Array.isArray(r.never_pair) ? r.never_pair : [],
    requiredCoverage: Array.isArray(r.required_coverage) ? r.required_coverage : [],
    version: r.version ?? 1,
    effectiveFrom: r.effective_from ?? null,
    sourceUrl: r.source_url ?? null,
  };
}

/**
 * The entries in force. Returns `ok: false` when the base could not be read —
 * "we found nothing" and "we could not look" must not collapse into the same
 * answer, because the caller treats the second as a reason to hold.
 */
export async function loadLegalKb(
  tenantId: string,
): Promise<{ ok: boolean; entries: KbEntry[] }> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("legal_kb_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .is("effective_to", null);
    if (error) {
      if (/legal_kb_entries|does not exist|schema cache/i.test(error.message)) {
        return { ok: true, entries: [] };
      }
      console.warn("[legal-kb] load failed:", error.message);
      return { ok: false, entries: [] };
    }
    return { ok: true, entries: (data ?? []).map(rowToEntry) };
  } catch (e) {
    console.warn("[legal-kb] load failed:", e);
    return { ok: false, entries: [] };
  }
}

/* -------------------------------------------------------------------------- */
/* Matching helpers                                                           */
/* -------------------------------------------------------------------------- */

const lower = (s: string) => s.toLowerCase();

/** Sentences, kept with their offsets so a finding can anchor to a real span. */
function sentences(body: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[0].trim();
    if (text) out.push({ text, index: m.index });
  }
  return out;
}

/** Does this entry apply to this draft at all? */
function entryApplies(body: string, entry: KbEntry): boolean {
  const b = lower(body);
  return entry.matchKeywords.some((k) => k.trim() && b.includes(lower(k)));
}

/** Sentences that mention this entry's subject — where its rules are checked. */
function topicSentences(body: string, entry: KbEntry): { text: string; index: number }[] {
  return sentences(body).filter((s) => {
    const t = lower(s.text);
    return entry.matchKeywords.some((k) => k.trim() && t.includes(lower(k)));
  });
}

/** Money as written in prose: $1,199.10 / $1200 / $1,200.00. */
const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g;

function moneyToNumber(s: string): number | null {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What the derivation says the value should be, from the firm's own facts.
 *
 * Returns null when the source fact is missing or unparseable, rather than
 * guessing — a derivation that cannot be computed must produce no finding at
 * all, not a finding against a number invented here.
 */
export function derivedValue(
  derivation: KbDerivation,
  facts: readonly CurrentFact[] = CURRENT_FACTS,
): number | null {
  const source = facts.find((f) => f.id === derivation.fromFactId);
  if (!source) return null;
  const base = moneyToNumber((source.value.match(MONEY_RE) ?? [])[0] ?? "");
  if (base === null) return null;
  const out = base * derivation.multiplier;
  return Number.isFinite(out) ? Math.round(out * 100) / 100 : null;
}

/* -------------------------------------------------------------------------- */
/* The four rule classes                                                      */
/* -------------------------------------------------------------------------- */

export type KbCheckResult = {
  findings: NormalizedFinding[];
  /** Titles of findings severe enough to hold the draft. */
  blockingReasons: string[];
  /** True when the base could not be read — an infra failure, not a pass. */
  failed: boolean;
  /** How many entries were in force and how many applied to this draft. */
  stats: { entries: number; applied: number };
};

function finding(args: {
  rule: "R1" | "R2" | "R3" | "R4";
  topic: string;
  severity: "critical" | "important" | "advisory";
  title: string;
  detail: string;
  excerpt: string;
  fix: string;
  sourceUrl: string | null;
}): NormalizedFinding {
  return {
    fingerprint: fingerprintFinding("legal", `kb:${args.rule}:${args.topic}`, args.excerpt),
    source: "legal",
    ruleId: `kb:${args.rule}:${args.topic}`,
    severity: args.severity,
    title: args.title,
    detail: args.detail,
    excerpt: args.excerpt.slice(0, 300),
    fix: args.fix,
    sourceChecked: args.sourceUrl,
  };
}

/**
 * Run every rule class over a draft.
 *
 * Severity by rule class, and the split is deliberate:
 *
 *   R1 and R3 are CRITICAL. A wrong citation and a wrong number are both
 *   verifiably false — the base says what the right answer is, so there is
 *   nothing to weigh. These hold the draft.
 *
 *   R2 and R4 are IMPORTANT. "This statement needs a qualifier" and "this draft
 *   does not mention X" are judgements about a particular piece of writing, and
 *   a base cannot know that the qualifier appears two paragraphs up in
 *   different words. Blocking on them would train reviewers to dismiss the
 *   whole layer, which costs more than the misses do.
 */
export async function runKbChecks(
  body: string,
  opts: { tenantId: string; facts?: readonly CurrentFact[] },
): Promise<KbCheckResult> {
  const { ok, entries } = await loadLegalKb(opts.tenantId);
  if (!ok) {
    return { findings: [], blockingReasons: [], failed: true, stats: { entries: 0, applied: 0 } };
  }
  const text = body ?? "";
  if (!entries.length || !text.trim()) {
    return {
      findings: [],
      blockingReasons: [],
      failed: false,
      stats: { entries: entries.length, applied: 0 },
    };
  }

  const facts = opts.facts ?? CURRENT_FACTS;
  const findings: NormalizedFinding[] = [];
  const blocking: string[] = [];
  let applied = 0;

  for (const entry of entries) {
    if (!entryApplies(text, entry)) continue;
    applied += 1;
    const hits = topicSentences(text, entry);

    /* R1 — wrong authority or forum -------------------------------------- */
    //
    // Per SENTENCE, not per listed citation. The list holds the variants a
    // writer might use — "Article 6", "NYLL Article 6", "Labor Law Article 6" —
    // and "New York Labor Law Article 6" contains all three. Looping the list
    // would raise three findings for one mistake, which is the flat unreadable
    // panel item 12 exists to get away from. The LONGEST match wins because it
    // is the most specific thing the writer actually wrote.
    for (const hit of hits) {
      // A sentence carrying the right citation too is discussing both, which is
      // legitimate — the error is citing the wrong one FOR this rule.
      if (entry.canonicalCitation && lower(hit.text).includes(lower(entry.canonicalCitation))) {
        continue;
      }
      const matched = entry.wrongCitations
        .filter((w) => w.trim() && lower(hit.text).includes(lower(w)))
        .sort((a, b) => b.length - a.length)[0];
      if (!matched) continue;

      const f = finding({
        rule: "R1",
        topic: entry.topic,
        severity: "critical",
        title: `${matched} is not the authority for ${entry.label}`,
        detail: entry.canonicalCitation
          ? `The rule lives in ${entry.canonicalCitation}. ${entry.citationSays ?? ""}`.trim()
          : `${matched} does not govern this point.`,
        excerpt: hit.text,
        fix: entry.canonicalCitation
          ? `Cite ${entry.canonicalCitation} instead, or move the claim to what ${matched} actually covers.`
          : `Replace the citation with the provision that governs this point.`,
        sourceUrl: entry.sourceUrl,
      });
      findings.push(f);
      blocking.push(f.title);
    }

    /* R3 — fact and citation validation ----------------------------------- */
    //
    // Two comparisons, not one. A figure is checked against the stored value
    // AND against the derivation, because those can disagree: the firm's own
    // facts table can carry a stale number, and a check that only compared
    // against it would certify the stale number as correct. That is exactly the
    // $1,199.10 case — the table says it, the formula says otherwise.
    const expectedFromValue = entry.currentValue ? moneyToNumber(entry.currentValue) : null;
    const expectedFromDerivation = entry.derivation ? derivedValue(entry.derivation, facts) : null;

    if (expectedFromValue !== null || expectedFromDerivation !== null) {
      const accepted = new Set(
        [expectedFromValue, expectedFromDerivation].filter((n): n is number => n !== null),
      );
      for (const hit of hits) {
        for (const raw of hit.text.match(MONEY_RE) ?? []) {
          const stated = moneyToNumber(raw);
          if (stated === null || accepted.has(stated)) continue;
          const expectations: string[] = [];
          if (expectedFromDerivation !== null && entry.derivation) {
            expectations.push(
              `${formatMoney(expectedFromDerivation)} by the stated formula (${entry.derivation.formula})`,
            );
          }
          if (expectedFromValue !== null) {
            expectations.push(`${formatMoney(expectedFromValue)} on record`);
          }
          const f = finding({
            rule: "R3",
            topic: entry.topic,
            severity: "critical",
            title: `${raw.trim()} does not match ${entry.label}`,
            detail: `Expected ${expectations.join("; ")}.${
              entry.citationSays ? ` ${entry.citationSays}` : ""
            }`,
            excerpt: hit.text,
            fix: `Correct the figure, or confirm which value is right — the knowledge base and the draft disagree.`,
            sourceUrl: entry.sourceUrl,
          });
          findings.push(f);
          blocking.push(f.title);
        }
      }
    }

    // The base's own two sources disagreeing is a finding in its own right, and
    // a more useful one than any per-draft flag: it means every draft on this
    // topic is being measured against a number nobody has reconciled.
    if (
      expectedFromValue !== null &&
      expectedFromDerivation !== null &&
      expectedFromValue !== expectedFromDerivation
    ) {
      const f = finding({
        rule: "R3",
        topic: entry.topic,
        severity: "important",
        title: `The knowledge base disagrees with itself on ${entry.label}`,
        detail: `Recorded value ${formatMoney(expectedFromValue)}, but ${
          entry.derivation?.formula ?? "the derivation"
        } gives ${formatMoney(expectedFromDerivation)}. An attorney needs to settle which is right.`,
        excerpt: entry.label,
        fix: `Reconcile legal_kb_entries.current_value with the derivation for ${entry.topic}.`,
        sourceUrl: entry.sourceUrl,
      });
      findings.push(f);
    }

    /* R2 — missing qualifier or overbroad --------------------------------- */
    if (entry.requiredQualifiers.length && hits.length) {
      // Checked against the WHOLE draft, not the sentence. A qualifier
      // established in the opening paragraph governs what follows, and
      // demanding it in every sentence would flag correct writing constantly.
      const b = lower(text);
      const present = entry.requiredQualifiers.some((q) => q.trim() && b.includes(lower(q)));
      if (!present) {
        findings.push(
          finding({
            rule: "R2",
            topic: entry.topic,
            severity: "important",
            title: `${entry.label} is stated without a qualifier`,
            detail: `The draft discusses this without any of: ${entry.requiredQualifiers.join(", ")}. As written it reads as covering everyone.`,
            excerpt: hits[0].text,
            fix: `Add the qualifier that makes the statement accurate, or narrow the claim.`,
            sourceUrl: entry.sourceUrl,
          }),
        );
      }
    }

    /* R2 — never-pair facts ------------------------------------------------ */
    for (const pair of entry.neverPair) {
      if (!pair?.a || !pair?.b) continue;
      const b = lower(text);
      if (!b.includes(lower(pair.a)) || !b.includes(lower(pair.b))) continue;
      const hit = hits.find((s) => lower(s.text).includes(lower(pair.a))) ?? hits[0];
      const f = finding({
        rule: "R2",
        topic: entry.topic,
        severity: "critical",
        title: `"${pair.a}" and "${pair.b}" cannot both be true here`,
        detail: pair.why ?? `${entry.label}: these two do not go together.`,
        excerpt: hit?.text ?? pair.a,
        fix: `Remove or correct whichever of the two does not apply.`,
        sourceUrl: entry.sourceUrl,
      });
      findings.push(f);
      blocking.push(f.title);
    }

    /* R4 — completeness ---------------------------------------------------- */
    if (entry.requiredCoverage.length && hits.length) {
      const b = lower(text);
      const missing = entry.requiredCoverage.filter((c) => {
        // Coverage items are phrases, so match on their distinctive words
        // rather than the whole sentence a writer would never reproduce.
        const words = lower(c).split(/\s+/).filter((w) => w.length > 3);
        if (!words.length) return false;
        return !words.every((w) => b.includes(w));
      });
      if (missing.length) {
        findings.push(
          finding({
            rule: "R4",
            topic: entry.topic,
            severity: "important",
            title: `${entry.label} is covered incompletely`,
            detail: `A draft on this topic should also cover: ${missing.join("; ")}.`,
            excerpt: hits[0].text,
            fix: `Add the missing point, or say why it does not apply to this piece.`,
            sourceUrl: entry.sourceUrl,
          }),
        );
      }
    }
  }

  return {
    findings,
    blockingReasons: [...new Set(blocking)],
    failed: false,
    stats: { entries: entries.length, applied },
  };
}
