/**
 * The source check (Oct 20 spec, Task A7): every legal claim in a draft is
 * checked against the primary source of its knowledge base entry BEFORE the
 * draft can reach Ready, not only at approval.
 *
 * For each claim (a deadline, dollar figure, employee count, statute or case
 * in the article):
 *   1. find its knowledge base entry (a threshold whose keywords the sentence
 *      carries, or a statute table row it names);
 *   2. open the entry's source URL, if it is an allowed source, and ask the
 *      model to quote the passage that supports or contradicts the sentence;
 *   3. keep { claim, source_url, quote, verdict, checked_at } on the draft
 *      (metadata.source_check).
 *
 * Verdicts:
 *   supported     the source says it (with a quote found verbatim in the source)
 *   contradicted  the source says otherwise (quote verified, confirmed twice)
 *   not_found     the source does not settle it, or could not be read
 *   no_entry      no knowledge base entry covers the claim
 *   answered      an attorney approved this exact sentence (Legal Review)
 * not_found and no_entry are "Needs a decision" items for the practice area
 * attorney; contradicted is fixed by Improve to Ready (Task A9) from the
 * knowledge base value, or goes to the attorney.
 *
 * COST: each claim is checked once per version. The cache key is the
 * sentence, its entry and the entry's value and source, so a claim is
 * re-checked only when the sentence or its knowledge base entry changes.
 *
 * Grounding: a quote is accepted only if its words are in the source text;
 * a contradiction must also be reproduced by the existing double check
 * (lib/legal-verify.ts verifyClaimAgainst). A failure is never a finding
 * against the content: it is not_found, for a person.
 */
import { createHash } from "node:crypto";
import { splitSentences } from "./legal-classifier";
import { inLegalScope } from "./legal-scope";
import { findCitations } from "./legal-citation";
import { focusedExcerpt, quoteRelatesToClaim } from "./authority-excerpt";
import type { KbThresholdEntry } from "./legal-knowledge-base";
import { CODE_CONTEXT, type StatuteRow } from "./legal-statute-table";
import type { DraftContent } from "./draft-frame";

export type SourceClaimType = "deadline" | "dollar" | "employee_count" | "statute" | "case";
export type SourceVerdict = "supported" | "contradicted" | "not_found" | "no_entry" | "answered";

export type SourceCheckEntry = {
  hash: string;
  sentence: string;
  type: SourceClaimType;
  kb_key: string | null;
  kb_label: string | null;
  source_url: string | null;
  /** The source is a verbatim reproduction (Cornell LII, American Legal), not the official site. */
  reproduction?: boolean;
  quote: string | null;
  verdict: SourceVerdict;
  reason: string;
  /** The closest passage, for a decision item. */
  closest?: string | null;
  checked_at: string;
};

export type SourceCheckRecord = { version: 1; checked_at: string; entries: SourceCheckEntry[] };

export function readSourceCheck(meta: Record<string, unknown> | null | undefined): SourceCheckRecord | null {
  const r = meta?.source_check as SourceCheckRecord | undefined;
  return r && r.version === 1 && Array.isArray(r.entries) ? r : null;
}

/* ------------------------------------------------------------------------- */
/* Allowed sources                                                           */
/* ------------------------------------------------------------------------- */

/** Primary sources only (Task A7): agencies, legislatures, courts. */
const PRIMARY_HOSTS = [
  "eeoc.gov",
  "dol.gov",
  "ecfr.gov",
  "govinfo.gov",
  "uscode.house.gov",
  "dol.ny.gov",
  "labor.ny.gov",
  "nysenate.gov",
  "legislation.nysenate.gov",
  "dhr.ny.gov",
  "ag.ny.gov",
  "nyc.gov",
  "paidfamilyleave.ny.gov",
  "nj.gov",
  "njoag.gov",
  "njleg.state.nj.us",
  "pub.njleg.gov",
  "njcourts.gov",
  "nycourts.gov",
  "uscourts.gov",
  "supremecourt.gov",
  "courtlistener.com",
];
/**
 * Verbatim reproductions of official text that the knowledge base already
 * cites (13 thresholds on Cornell LII, NYC Administrative Code on American
 * Legal Publishing, the city's official publisher). Accepted and marked, so
 * the Sources panel shows they are not the official site. Kept as accepted
 * reproductions (Kenneth, 2026-10-21).
 */
const REPRODUCTION_HOSTS = ["law.cornell.edu", "codelibrary.amlegal.com"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
const onHost = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

export function sourceStanding(url: string | null): "primary" | "reproduction" | "not_allowed" {
  const h = url ? hostOf(url) : null;
  if (!h) return "not_allowed";
  if (onHost(h, PRIMARY_HOSTS)) return "primary";
  if (onHost(h, REPRODUCTION_HOSTS)) return "reproduction";
  return "not_allowed";
}

/* ------------------------------------------------------------------------- */
/* Claims                                                                    */
/* ------------------------------------------------------------------------- */

const DOLLAR = /\$\s?\d/;
// English and Spanish (Oct 20 spec, Task A13): a Spanish draft's claims are
// found and checked the same way.
const DEADLINE =
  /\b(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|sixty|ninety)\s+(?:calendar\s+|business\s+)?(?:days?|months?|years?)\b|\b(?:\d[\d,]*|un|una|dos|tres|cuatro|cinco|seis|diez|doce|quince|veinte|treinta|sesenta|noventa)\s+(?:d[ií]as?|meses|mes|a[nñ]os?)(?:\s+(?:calendario|h[aá]biles))?\b/i;
const EMPLOYEES =
  /\b(?:\d[\d,]*|one|two|three|four|five|six|ten|fifteen|twenty|fifty)\s*\+?\s*(?:or\s+more\s+|or\s+fewer\s+)?employees?\b|\ball employers\b|\bany size\b|\bregardless of (?:their )?size\b|\b(?:\d[\d,]*|cuatro|cinco|quince|veinte|cincuenta)\s*(?:o\s+m[aá]s\s+|o\s+menos\s+)?emplead[oa]s\b|\btodos\s+los\s+empleadores\b/i;
const DEADLINE_CONTEXT =
  /\b(?:file|filing|deadline|sue|lawsuit|complaint|charge|statute of limitations|limitations period|enforce|enforceable|years? to|days? to|presentar|demanda|demandar|plazo|queja|reclamo|prescripci[oó]n|cargo)\b/i;
const EMPLOYEES_CONTEXT =
  /\b(?:law|act|title vii|ada|adea|fmla|nyshrl|nychrl|njlad|flsa|covers?|applies|apply|ley|aplica|cubre|t[ií]tulo vii)\b/i;
const CASE_NAME = /\b[A-Z][A-Za-z.&'-]+(?:\s+[A-Z][A-Za-z.&'-]+)*\s+v\.\s+[A-Z][A-Za-z.&'-]+/;

const NOT_A_CLAIM =
  /\b(?:typically|usually|often|generally) (?:takes?|lasts?|resolves?)\b|\b(?:may|can|could) take\b|\btakes? (?:about |roughly |around )?(?:one|two|three|\d+) (?:to|or) (?:two|three|four|\d+) (?:months|years)\b|\b(?:settled|settlement) (?:for|of)\s+\$|\b(?:we|the firm|our firm|our client|the client) (?:recovered|secured|obtained|won)\b/i;

export type SourceClaim = { sentence: string; type: SourceClaimType };

/** The article's prose: never the frame (label, byline, CTA, disclaimer). */
export function articleText(content: DraftContent): string {
  return [
    content.direct_answer,
    content.intro,
    ...content.sections.map((s) => `${s.h2}\n${s.body}`),
    ...content.faq.map((f) => `${f.q}\n${f.a}`),
    content.case_result.text,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Legal claims the source check covers (spec: deadline, dollar, employee count, statute, case, coverage). */
export function extractSourceClaims(text: string): SourceClaim[] {
  const out: SourceClaim[] = [];
  const seen = new Set<string>();
  // "Sabetay v. Sterling Drug" is one sentence: the splitter would break at "v.".
  const VS = "․";
  for (const s of splitSentences(text.replace(/\b(v|vs)\.\s/g, `$1${VS} `))) {
    const sentence = s.text.replaceAll(VS, ".").replace(/\s+/g, " ").trim();
    if (!sentence || /^#+\s/.test(sentence) || seen.has(sentence)) continue;
    // Not legal claims: how long a case usually takes, and case results
    // (a result is Diana's item, Task A9, not the attorney's).
    if (NOT_A_CLAIM.test(sentence)) continue;
    const citations = findCitations(sentence);
    let type: SourceClaimType | null = null;
    // A figure only counts inside the legal scope rule (a citation or a legal
    // figure, lib/legal-scope.ts): "most cases settle within two years" is not
    // a claim for an attorney.
    const scoped = inLegalScope(sentence);
    if (CASE_NAME.test(sentence)) type = "case";
    else if (scoped && DEADLINE.test(sentence) && DEADLINE_CONTEXT.test(sentence)) type = "deadline";
    else if (scoped && DOLLAR.test(sentence)) type = "dollar";
    else if (scoped && EMPLOYEES.test(sentence) && EMPLOYEES_CONTEXT.test(sentence)) type = "employee_count";
    else if (citations.length > 0) type = "statute";
    if (!type) continue;
    seen.add(sentence);
    out.push({ sentence, type });
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Matching a claim to its knowledge base entry                              */
/* ------------------------------------------------------------------------- */

export type EntryMatch = { kind: "threshold" | "statute"; key: string; label: string; sourceUrl: string | null; value: string };

function keywordsMatch(entry: KbThresholdEntry, sentence: string): boolean {
  if (entry.matchKeywords.length === 0) return false;
  const hay = sentence.toLowerCase();
  return entry.matchKeywords.every((g) => g.split("|").some((t) => t.trim() && hay.includes(t.trim().toLowerCase())));
}

const UNITS: Record<SourceClaimType, KbThresholdEntry["unit"][]> = {
  dollar: ["usd_per_hour", "usd_per_week", "usd_per_year"],
  deadline: ["days", "years"],
  employee_count: ["employees"],
  statute: [],
  case: [],
};

function jurisdictionOf(sentence: string): KbThresholdEntry["jurisdiction"] | null {
  if (/\bNew Jersey\b|\bNJ\b/i.test(sentence)) return "NJ";
  if (/\bNew York\b|\bNYC?\b/i.test(sentence)) return "NY";
  if (/\bfederal\b|\bFLSA\b/i.test(sentence)) return "federal";
  return null;
}

export function matchEntry(claim: SourceClaim, thresholds: readonly KbThresholdEntry[], statutes: readonly StatuteRow[]): EntryMatch | null {
  const units = UNITS[claim.type];
  if (units.length) {
    const keyed = thresholds
      .filter((t) => units.includes(t.unit) && keywordsMatch(t, claim.sentence))
      .sort((a, b) => b.matchKeywords.length - a.matchKeywords.length)[0];
    // Wage figures have no keywords: the jurisdiction and the figure's unit
    // ("$16.00 an hour", "$1,199.10 per week") settle them. A dollar amount
    // with no unit (a court's $20,000 limit) is not a wage claim.
    const j = jurisdictionOf(claim.sentence);
    const unit = /\$\s?[\d,.]+\s*(?:per|an?|\/)\s*(hour|hr|week|wk|year|yr)\b/i.exec(claim.sentence)?.[1]?.toLowerCase();
    const wanted = unit ? (unit.startsWith("h") ? "usd_per_hour" : unit.startsWith("w") ? "usd_per_week" : "usd_per_year") : null;
    const byPlace =
      !keyed && claim.type === "dollar" && j && wanted
        ? thresholds.find((t) => t.unit === wanted && t.jurisdiction === j && t.matchKeywords.length === 0)
        : undefined;
    const t = keyed ?? byPlace;
    if (t) return { kind: "threshold", key: t.key, label: t.label, sourceUrl: t.sourceUrl, value: `${t.currentValue}|${t.effectiveDate ?? ""}` };
  }
  // A statute row only when the sentence names that body of law (CODE_CONTEXT)
  // and the section: "CPLR § 213" is not 29 U.S.C. § 213.
  // "CPLR § 5222", "CPLR 5222" and "CPLR §5222" are the same citation.
  const cite = (s: string) => s.toLowerCase().replace(/§/g, " ").replace(/\.(?=\s)/g, "").replace(/\s+/g, " ").trim();
  const lower = cite(claim.sentence);
  const row = statutes.find(
    (r) =>
      CODE_CONTEXT[r.code]?.test(claim.sentence) &&
      [r.citation, ...r.aliases].some((a) => {
        const t = a ? cite(a) : "";
        if (!t) return false;
        const at = lower.indexOf(t);
        return at !== -1 && !/[\w-]/.test(lower[at + t.length] ?? "");
      }),
  );
  if (row) return { kind: "statute", key: row.key, label: row.citation, sourceUrl: row.sourceUrl, value: row.covers };
  return null;
}

/** Re-check only when the sentence, its entry, the entry's value or its source change. */
export function claimHash(sentence: string, match: EntryMatch | null): string {
  const canonSentence = sentence.toLowerCase().replace(/[^a-z0-9$%.\s]/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha1")
    .update([canonSentence, match?.key ?? "", match?.value ?? "", match?.sourceUrl ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 20);
}

/* ------------------------------------------------------------------------- */
/* Readiness (pure)                                                          */
/* ------------------------------------------------------------------------- */

export type SourceStatus = {
  claims: number;
  unchecked: SourceClaim[];
  /** Every entry for a current claim, in article order. */
  current: SourceCheckEntry[];
};

/**
 * Which current claims have a stored result for exactly this version. A claim
 * whose sentence changed has no matching hash and counts as unchecked, so an
 * edit always sends the changed claim back through the check.
 */
export function sourceStatus(
  content: DraftContent,
  record: SourceCheckRecord | null,
  thresholds: readonly KbThresholdEntry[],
  statutes: readonly StatuteRow[],
  approved: ReadonlySet<string>,
  approvedKey: (s: string) => string,
): SourceStatus {
  const claims = extractSourceClaims(articleText(content));
  const byHash = new Map((record?.entries ?? []).map((e) => [e.hash, e]));
  const unchecked: SourceClaim[] = [];
  const current: SourceCheckEntry[] = [];
  for (const c of claims) {
    const hash = claimHash(c.sentence, matchEntry(c, thresholds, statutes));
    const e = byHash.get(hash);
    if (approved.has(approvedKey(c.sentence))) {
      current.push(
        e
          ? { ...e, verdict: e.verdict === "contradicted" ? e.verdict : "answered" }
          : { hash, sentence: c.sentence, type: c.type, kb_key: null, kb_label: null, source_url: null, quote: null, verdict: "answered", reason: "Approved by an attorney.", checked_at: "" },
      );
    } else if (e) current.push(e);
    else unchecked.push(c);
  }
  return { claims: claims.length, unchecked, current };
}

/** The question for the attorney on a decision item. */
export function decisionQuestion(e: SourceCheckEntry): string {
  return e.verdict === "no_entry"
    ? "No knowledge base entry covers this. Is the sentence correct as written? If so, approve it (and add the rule); if not, give the correct sentence."
    : "The source does not settle this. Is the sentence correct as written? If not, give the correct sentence.";
}

/* ------------------------------------------------------------------------- */
/* The model step                                                            */
/* ------------------------------------------------------------------------- */

const SYSTEM = `You check one legal claim against the text of its primary source.

Answer ONLY from the source text provided. You have no other knowledge for this task.

Return one of:
- "supported": the source text states what the claim says. Quote the passage that says it, copied verbatim.
- "contradicted": the source text states something different. Quote the conflicting passage, copied verbatim.
- "not_found": the source text does not address the point, or is too partial to tell. Quote the closest passage, or leave it empty.

A claim that adds detail the text does not cover is "not_found", not "contradicted".

Return JSON only:
{"verdict":"supported|contradicted|not_found","quote":"<verbatim passage>","reason":"<one sentence>"}`;

function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function quoteIsIn(quote: string, sourceText: string): boolean {
  const q = canon(quote);
  return q.length >= 12 && canon(sourceText).includes(q);
}

export type ModelAsk = (system: string, user: string) => Promise<string>;

/** One claim against one source text. Pure apart from the injected model call. */
export async function judgeClaim(
  sentence: string,
  sourceText: string,
  ask: ModelAsk,
  confirmContradiction: (sentence: string, text: string) => Promise<boolean>,
): Promise<{ verdict: "supported" | "contradicted" | "not_found"; quote: string | null; reason: string; closest: string | null }> {
  const excerpt = focusedExcerpt(sourceText, sentence);
  let raw: string;
  try {
    raw = await ask(SYSTEM, `CLAIM:\n"""\n${sentence}\n"""\n\nSOURCE TEXT:\n"""\n${excerpt}\n"""`);
  } catch (e) {
    return { verdict: "not_found", quote: null, reason: `Could not be checked: ${e instanceof Error ? e.message : String(e)}`, closest: null };
  }
  let parsed: { verdict?: string; quote?: string; reason?: string } | null = null;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    parsed = null;
  }
  const quote = typeof parsed?.quote === "string" ? parsed.quote.trim() : "";
  const reason = parsed?.reason || "No reason given.";
  const grounded = quote && quoteIsIn(quote, sourceText) && quoteRelatesToClaim(quote, sentence);
  if (parsed?.verdict === "supported" && grounded) return { verdict: "supported", quote, reason, closest: null };
  if (parsed?.verdict === "contradicted" && grounded && (await confirmContradiction(sentence, sourceText))) {
    return { verdict: "contradicted", quote, reason, closest: null };
  }
  const why =
    parsed?.verdict === "supported" || parsed?.verdict === "contradicted"
      ? `The model said ${parsed.verdict}, but its passage could not be found in the source or was not confirmed, so it was not accepted.`
      : reason;
  return { verdict: "not_found", quote: null, reason: why, closest: quote && quoteIsIn(quote, sourceText) ? quote : excerpt.slice(0, 300) };
}
