/**
 * Check the Sept 28 known-trap additions (spec 11.6) and false-alarm fixes
 * (spec 11.7) against the REAL matcher before they go into the database.
 *
 *   node scripts/run.mjs scripts/check-known-traps-sept28.ts
 *
 * Every trap below is duplicated verbatim from
 * supabase/content_known_traps_sept28.sql. Keep the two in sync: if a pattern
 * changes in one place, change it in the other and re-run this script. It does
 * not parse the SQL on purpose, so a bad copy fails loudly here instead of
 * silently passing.
 *
 * Why the patterns are sentence-scoped regexes and not all_of rows:
 * matchTrap()'s all_of / all_of_unless forms test co-occurrence across the
 * WHOLE body, and its `unless` list also clears on the whole body. That is what
 * made the old "FMLA paired with EEOC" row fire on any draft that mentioned
 * both, and why the 300-char NYSHRL window reached into the next (correct)
 * NYCHRL sentence. The regex branch ignores `unless`, so the "same sentence"
 * and "unless" logic is written into the regex itself:
 *
 *   START  (?:^|(?<=\n)|(?<=[.!?])(?!\w))       sentence start
 *   SC     (?:[^.!?\n]|[.!?](?=\w))              one in-sentence character; a
 *                                               period followed by a word
 *                                               character ("$17.00", "U.S.C")
 *                                               does not end the sentence
 *   (?=SC*?term)   term must appear in the same sentence
 *   (?!SC*?term)   term must NOT appear in the same sentence (the "unless")
 *   SC+            consume the sentence, so the hit's excerpt is that sentence
 *
 * Apostrophes are written as [\x27’] so the SQL needs no quote-doubling
 * and the SQL string and the TS string are byte-identical.
 */

import { matchTrap, type KnownTrap } from "../lib/known-traps";

type Sev = KnownTrap["severity"];

function trap(
  label: string,
  severity: Sev,
  matchType: KnownTrap["matchType"],
  pattern: string,
  unless: string[] = [],
): KnownTrap {
  return { id: label, label, matchType, pattern, unless, severity, note: "", enabled: true };
}

// ---------------------------------------------------------------------------
// Traps — verbatim copies of supabase/content_known_traps_sept28.sql
// ---------------------------------------------------------------------------

const T = {
  // 11.6 #1
  cchr: trap(
    "NYC Commission on Human Rights deadline stated as three years",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:NYCCHR|CCHR|Commission\s+on\s+Human\s+Rights)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:three|3)[\s-]+years?\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:one|1)[\s-]+year\b|\bgender[\s-]+based\b|\bcourt\b|\blawsuit\b|\bsue\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #2
  fees: trap(
    "Cost of representation or free / low-cost language",
    "critical",
    "regex",
    String.raw`\bwithout\s+(?:having\s+to\s+)?pay(?:ing)?\s+(?:any\s+)?(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\b|\bpay(?:ing)?\s+(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\s+out\s+of\s+pocket\b|\bfree\s+or\s+low[\s-]+cost\b|\bat\s+no\s+cost\b`,
  ),
  // 11.6 #3
  figures: trap(
    "Outcome figures or damages-size language",
    "critical",
    "regex",
    String.raw`\b(?:six|seven|eight)[\s-]+figures?\b|\btens\s+of\s+thousands\s+of\s+dollars\b|\bsubstantial\s+(?:damages|awards?)\b`,
  ),
  // 11.6 #4
  tip196d: trap(
    "Section 196-d tied to the tip credit",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?<![\w.])196[\s-]?\(?d\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\btip[\s-]+credits?\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bdoes\s+not\b|\bdoesn[\x27’]t\b|\bnot\s+the\b|\brather\s+than\b|\bseparate(?:ly)?\s+from\b|\bdistinct\s+from\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #5
  lawsuitOnly: trap(
    "Remedies described as available only through a lawsuit",
    "critical",
    "regex",
    String.raw`\b(?:only\s+available|available\s+only)\s+(?:through|in|via|by)\s+(?:(?:a|filing\s+a)\s+)?(?:private\s+)?(?:lawsuit|court)\b`,
  ),
  // 11.6 #6
  uniforms: trap(
    "Uniform deductions described as allowed with authorization",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bdeduct\w*))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\buniforms?\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bauthori[sz]\w*|\bconsent\w*))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\beven\s+(?:if|with|when)\b|\bprohibit\w*))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #7
  personnel: trap(
    "Right to see a personnel file stated for New York",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bpersonnel\s+(?:files?|records?)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bright\s+to\b|\bentitled\s+to\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bno\s+(?:general\s+|legal\s+|statutory\s+)*right\b|\bpublic[\s-]+(?:sector|employees?)\b|\bCalifornia\b|\b(?:other|some)\s+states\b|\bunion\b|\bcollective\s+bargaining\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #8
  per250: trap(
    "Wage notice / statement damages stated as $250 per violation",
    "critical",
    "regex",
    String.raw`\$\s?250\s+(?:per|for\s+each|each|a)\s+violation\b`,
  ),
  // 11.6 #9 (three narrower rows)
  minwage: trap(
    "New York minimum wage stated as a figure other than $17.00 or $16.00",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:New\s+York|NYC|NY|Long\s+Island|Westchester|Nassau|Suffolk)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bminimum\s+(?:hourly\s+)?wage\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\$\s?(?!1[67]\.00\b)1\d\.\d\d\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?!2026\b)(?:19|20)\d\d\b|\b(?:was|were|previously|formerly|prior)\b|\bused\s+to\b|\bfrom\s+\$|\bNew\s+Jersey\b|\bNJ\b|\bfederal\b|\bFLSA\b|\btipped\b|\btip\s+credit\b|\bcash\s+wage\b|\bfood\s+service\b|\bservice\s+(?:employees?|workers?)\b|\bhome\s+(?:care|health)\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  minwageNyc16: trap(
    "NYC / Long Island / Westchester minimum wage stated as $16.00",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:New\s+York\s+City|NYC|Long\s+Island|Westchester|Nassau|Suffolk)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bminimum\s+(?:hourly\s+)?wage\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\$\s?16(?:\.00)?(?!\.?\d)))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?!2026\b)(?:19|20)\d\d\b|\brest\s+of\b|\bremainder\b|\belsewhere\b|\boutside\b|\bupstate\b|\bother\s+(?:parts|areas|counties|regions)\b|\bbalance\s+of\b|\b(?:was|were|previously|formerly)\b|\bfrom\s+\$|\bNew\s+Jersey\b|\bNJ\b|\btipped\b|\btip\s+credit\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  asOf2025: trap(
    "Figure dated \"as of 2025\"",
    "critical",
    "regex",
    String.raw`\bas\s+of\s+(?:(?:January|Jan\.?)\s+1,?\s+)?2025\b`,
  ),
  // 11.6 #10
  caps: trap(
    "Title VII damages caps applied to the NYSHRL",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bNYSHRL\b|\b(?:New\s+York\s+)?State\s+Human\s+Rights\s+Law\b|\bstate\s+law\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:caps?|capped)\b|\blimited\s+to\s+\$|\$\s?300,000\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bno\s+(?:\w+\s+)?(?:caps?|limits?)\b|\buncapped\b|\bunlimited\b|\bwithout\s+(?:a\s+|any\s+)?(?:caps?|limits?)\b|\bunlike\b|\bwhereas\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #11 (important)
  severe: trap(
    "Severe or pervasive stated without a New York qualifier",
    "important",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bsevere\s+(?:or|and\/or)\s+pervasive\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bfederal\b|\bTitle\s+VII\b|\bEEOC\b|\bno\s+longer\b|\bdoes\s+not\s+require\b|\bnot\s+required\b|\bneed\s+not\b|\b(?:does|do|need)\s+not\s+(?:have\s+to\s+|need\s+to\s+)?(?:be|require|meet|show|prove)\b|\bdo(?:es)?n[\x27’]t\s+(?:need|have)\b|\beliminat\w*|\babolish\w*|\binstead\s+of\b|\brather\s+than\b|\bpetty\s+slights\b|\bnot\s+(?:always\s+)?need\b|\bremov\w*|\breject\w*|\b2019\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #12 (important)
  fmlaLiq: trap(
    "FMLA liquidated damages tied to willfulness",
    "important",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bliquidated\s+damages\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bwillful\w*))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:two|three|2|3)[\s-]+years?\b|\bthree\s+(?:if|for|when|where)\b|\bstatute\s+of\s+limitations\b|\blimitations\s+period\b|\bgood[\s-]+faith\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #13
  exhaust: trap(
    "FMLA paid-leave substitution described as prohibited",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:may|can|could)\s*not\s+(?:force|require|make)\s+you\s+(?:to\s+)?(?:exhaust|use\s+up|substitute)\b|\bcan[\x27’]t\s+(?:force|require|make)\s+you\s+(?:to\s+)?(?:exhaust|use\s+up|substitute)\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bPaid\s+Family\s+Leave\b|\bPFL\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #14
  pflCourt: trap(
    "Paid Family Leave claims described as going to court",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bPaid\s+Family\s+Leave\b|\bPFL\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:in|to|into)\s+court\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bcannot\b|\bnever\b|\binstead\b|\barbitrat\w*|\bWorkers[\x27’]?\s+Compensation\s+Board\b|\bWCB\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.6 #15 (important) — whole-body on purpose, see the SQL comment
  efaa: trap(
    "Arbitration of sexual harassment claims without the EFAA",
    "important",
    "all_of_unless",
    `["arbitrat*","sexual harassment"]`,
    ["2022", "Ending Forced Arbitration", "EFAA", "court instead"],
  ),
  // 11.6 #16
  placeholder: trap(
    "Unfilled placeholder text",
    "critical",
    "regex",
    String.raw`\bPLACEHOLDER\b|\bReplace\s+before\s+publishing\b`,
  ),
  // 11.6 #17
  schema: trap(
    "Schema markup pasted into the body",
    "critical",
    "regex",
    String.raw`application\/ld\+json|["“]@context["”]`,
  ),
  // 11.6 #18
  sick2014: trap(
    "Old NYC sick leave start date (September 30, 2014)",
    "critical",
    "regex",
    String.raw`\bSept(?:ember|\.)?\s+30,?\s+2014\b`,
  ),

  // 11.7 a — UPDATE of the existing row
  nyshrlSize: trap(
    "NYSHRL with an employer-size threshold",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bNYSHRL\b|(?<!City\s)(?<!City[\x27’]s\s)(?<!NYC\s)\bHuman\s+Rights\s+Law\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?<![\w-])(?:four|4)\s+or\s+more\b|\bat\s+least\s+(?:four|4)\b|\bminimum\s+of\s+(?:four|4)\b|(?<![\w-])(?:four|4)\s+employees\b|\bfewer\s+than\s+(?:four|4)\b|\bmore\s+than\s+(?:four|4)\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\ball\s+employers\b|\bregardless\s+of\s+(?:their\s+|its\s+|the\s+)?(?:employer[\x27’]s\s+)?size\b|\bevery\s+employer\b|\bno\s+(?:minimum\s+)?(?:employee\s+|size\s+)?(?:threshold|minimum)\b|(?:\bNYCHRL\b|\bCity\s+Human\s+Rights\s+Law\b)[^.!?\n]{0,20}\bwhich\s+applies\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.7 b — UPDATE of the existing row
  firmEmployers: trap(
    "Firm positioned as representing employers",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:represents?|defends?)\s+employers\b|\bboth\s+employees\s+and\s+employers\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:does|do|did)\s+not\b|n[\x27’]t\b|\bnever\b|\bnot\s+employers\b|\bonly\s+employees\b|\bemployees\s+only\b|\b(?:some|other|many|most)\s+(?:employment\s+)?(?:attorneys|lawyers|firms)\b|\bmanagement[\s-]+side\b))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.7 c — UPDATE of the existing row, now the non-blocking review tier
  fmlaEeocReview: trap(
    "FMLA paired with EEOC",
    "important",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bADA\b|\bADEA\b|\bFLSA\b|\bNYLL\b|\bAmericans\s+with\s+Disabilities\b|\bAge\s+Discrimination\b|\bFair\s+Labor\s+Standards\b|\bNYSHRL\b|\bNYCHRL\b|\bHuman\s+Rights\s+Law\b|\bNJLAD\b|\bLaw\s+Against\s+Discrimination\b|\bDivision\s+of\s+Human\s+Rights\b|\bDepartment\s+of\s+Labor\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)\s+(?:handles?|enforces?|investigates?|administers?|processes|oversees)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:enforced|handled|investigated|administered|processed|overseen)\s+by\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.7 c — NEW blocking tier
  fmlaEeocFiled: trap(
    "FMLA claim routed to the EEOC",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)\s+(?:handles?|enforces?|investigates?|administers?|processes|oversees)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:enforced|handled|investigated|administered|processed|overseen)\s+by\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.7 c — UPDATE of the existing row, now the non-blocking review tier
  fmlaT7Review: trap(
    "FMLA paired with Title VII",
    "important",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bTitle\s+VII\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bADA\b|\bADEA\b|\bFLSA\b|\bNYLL\b|\bAmericans\s+with\s+Disabilities\b|\bAge\s+Discrimination\b|\bFair\s+Labor\s+Standards\b|\bNYSHRL\b|\bNYCHRL\b|\bHuman\s+Rights\s+Law\b|\bNJLAD\b|\bLaw\s+Against\s+Discrimination\b|\bDivision\s+of\s+Human\s+Rights\b|\bDepartment\s+of\s+Labor\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:under|through|via|pursuant\s+to|as\s+part\s+of|part\s+of|arising\s+under)\s+(?:the\s+)?Title\s+VII\b|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:is|are)\s+(?:a\s+)?(?:part\s+of|under|covered\s+by|governed\s+by|enforced\s+under)\s+Title\s+VII\b|\bTitle\s+VII\b\s+(?:governs|covers|includes|enforces)\b(?:[^.!?\n]|[.!?](?=\w)){0,15}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
  // 11.7 c — NEW blocking tier
  fmlaT7Filed: trap(
    "FMLA claim placed under Title VII",
    "critical",
    "regex",
    String.raw`(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:under|through|via|pursuant\s+to|as\s+part\s+of|part\s+of|arising\s+under)\s+(?:the\s+)?Title\s+VII\b|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:is|are)\s+(?:a\s+)?(?:part\s+of|under|covered\s+by|governed\s+by|enforced\s+under)\s+Title\s+VII\b|\bTitle\s+VII\b\s+(?:governs|covers|includes|enforces)\b(?:[^.!?\n]|[.!?](?=\w)){0,15}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)))(?:[^.!?\n]|[.!?](?=\w))+`,
  ),
} satisfies Record<string, KnownTrap>;

type Key = keyof typeof T;

// ---------------------------------------------------------------------------
// Cases: [trap, text, should it fire?]
// ---------------------------------------------------------------------------

const FIRE = true;
const PASS = false;

const cases: [Key, string, boolean][] = [
  // 1. NYC Commission on Human Rights deadline
  ["cchr", "You can file a complaint with the NYC Commission on Human Rights within three years.", FIRE],
  ["cchr", "NYCCHR complaints must be filed within 3 years.", FIRE],
  ["cchr", "To file with the New York City Commission on Human Rights, the deadline is three years.", FIRE],
  ["cchr", "You have one year to file with the NYC Commission on Human Rights, or three years for gender-based harassment.", PASS],
  ["cchr", "You have three years to file a lawsuit in court under the NYCHRL.", PASS],
  ["cchr", "You may file with the NYC Commission on Human Rights, or take three years to sue in court under the NYCHRL.", PASS],
  ["cchr", "File with the NYC Commission on Human Rights within one year. The NYSDHR deadline is three years.", PASS],

  // 2. Fee shifting, free / low cost (free consultation is ALLOWED, Kenneth 2026-09-29)
  // Attorney fee recovery is a remedy, allowed (Kenneth 2026-09-29).
  ["fees", "If you win, the employer must pay your legal fees.", PASS],
  ["fees", "Your employer may have to pay your attorneys’ fees and costs.", PASS],
  ["fees", "You may also recover attorney's fees and costs.", PASS],
  ["fees", "This fee-shifting provision helps level the playing field.", PASS],
  ["fees", "You can pursue the claim without having to pay legal fees out of pocket.", FIRE],
  ["fees", "Employees can sue without paying attorneys' fees.", FIRE],
  ["fees", "Legal aid groups offer free or low cost help.", FIRE],
  ["fees", "We review your case at no cost.", FIRE],
  ["fees", "Call today for a free consultation.", PASS],
  ["fees", "We offer a free consultation to discuss your options.", PASS],
  ["fees", "The employer pays the civil penalty to the state.", PASS],

  // 3. Outcome figures
  ["figures", "The firm has won six-figure or seven-figure verdicts.", FIRE],
  ["figures", "Clients have recovered tens of thousands of dollars.", FIRE],
  ["figures", "You may be entitled to substantial damages.", FIRE],
  ["figures", "Damages depend on the facts of your case.", PASS],
  ["figures", "Keep a record of every figure on your pay stub.", PASS],

  // 4. 196-d tied to the tip credit
  ["tip196d", "Section 196-d, which governs tip credit rules, protects restaurant workers.", FIRE],
  ["tip196d", "Under NYLL § 196-d, the tip credit your employer takes must be disclosed.", FIRE],
  ["tip196d", "Section 196-b requires paid sick leave, and the tip credit is set by the Wage Order.", PASS],
  ["tip196d", "In 1966 Congress created the tip credit.", PASS],
  ["tip196d", "Section 196-d prohibits employers from keeping your tips. The tip credit is set by the Hospitality Wage Order.", PASS],
  ["tip196d", "Section 196-d does not govern the tip credit.", PASS],

  // 5. DOL remedies denied
  ["lawsuitOnly", "These remedies are only available through a lawsuit, not through the Department of Labor process.", FIRE],
  ["lawsuitOnly", "Liquidated damages are available only in court.", FIRE],
  ["lawsuitOnly", "These remedies are available through a lawsuit or a Department of Labor complaint.", PASS],

  // 6. Uniform deductions with consent
  ["uniforms", "Your employer can deduct the cost of uniforms from your paycheck if you authorize it in writing.", FIRE],
  ["uniforms", "With your written consent, an employer may deduct uniform costs.", FIRE],
  ["uniforms", "Employers cannot deduct the cost of uniforms from your wages, even if you authorize it.", PASS],
  ["uniforms", "Deductions for uniforms are prohibited under New York law, whether or not you authorized them.", PASS],
  ["uniforms", "Your employer must provide uniforms. You never need to authorize a deduction from your pay.", PASS],

  // 7. Personnel file right in New York
  ["personnel", "In New York, you have the right to see your personnel file.", FIRE],
  ["personnel", "New York Labor Law Section 195(6) gives employees the right to inspect and copy their personnel files.", FIRE],
  ["personnel", "New York does not give private employees a right to see their personnel file.", PASS],
  ["personnel", "There is no general right to review your personnel file in New York.", PASS],
  ["personnel", "New York has no general right to access personnel files, but you can ask for yours.", PASS],
  ["personnel", "New York doesn’t give private employees a right to their personnel file.", PASS],

  // 8. $250 per violation
  ["per250", "Wage statement violations carry $250 per violation.", FIRE],
  ["per250", "You can recover $250 for each violation of the wage statement rule.", FIRE],
  ["per250", "Wage statement damages are $250 per day, up to $5,000.", PASS],

  // 9. Minimum wage
  ["minwage", "The New York minimum wage is $16.50 per hour.", FIRE],
  ["minwage", "In NYC, the minimum wage is $15.50 an hour for most workers.", FIRE],
  ["minwage", "The NYC minimum wage is $17.00 per hour in 2026.", PASS],
  ["minwage", "Outside NYC, Long Island and Westchester, the New York minimum wage is $16.00.", PASS],
  ["minwage", "NJ minimum wage is $15.92.", PASS],
  ["minwage", "New Jersey's minimum wage is $15.92, lower than New York's.", PASS],
  ["minwage", "The federal minimum wage is $7.25.", PASS],
  ["minwage", "In 2025 the NYC minimum wage was $16.50.", PASS],
  ["minwage", "In NYC, tipped food service workers receive a cash wage of $11.35 while the minimum wage is $17.00.", PASS],
  ["minwage", "The New York minimum wage rose from $16.50 to $17.00 this year.", PASS],
  ["minwage", "The NYC minimum wage is $17.00, so a 40-hour week pays $680.00.", PASS],
  ["minwageNyc16", "The NYC minimum wage is $16.00 per hour.", FIRE],
  ["minwageNyc16", "Workers on Long Island earn a minimum wage of $16 per hour.", FIRE],
  ["minwageNyc16", "The minimum wage is $17.00 in New York City, Long Island and Westchester and $16.00 in the rest of the state.", PASS],
  ["minwageNyc16", "In 2024 the New York City minimum wage was $16.00.", PASS],
  ["minwageNyc16", "The NYC minimum wage is $16.50 per hour.", PASS], // caught by minwage instead
  ["asOf2025", "As of 2025, most NYC workers must earn at least $16.50/hour.", FIRE],
  ["asOf2025", "The rate is $16.50 as of January 1, 2025.", FIRE],
  ["asOf2025", "As of 2026, the NYC minimum wage is $17.00.", PASS],

  // 10. Title VII caps applied to state law
  ["caps", "Damages under Title VII and the NYSHRL are capped at $300,000.", FIRE],
  ["caps", "NYSHRL compensatory damages are capped based on employer size.", FIRE],
  ["caps", "Title VII and the NYSHRL both prohibit sex discrimination.", PASS],
  ["caps", "Title VII caps damages, but the NYSHRL has no cap.", PASS],
  ["caps", "The NYSHRL has no cap on compensatory damages.", PASS],
  ["caps", "Damages under the NYSHRL are not capped.", PASS],

  // 11. Severe or pervasive without NY qualifier
  ["severe", "A hostile work environment exists when conduct is severe or pervasive.", FIRE],
  ["severe", "The NYSHRL also requires severe or pervasive conduct.", FIRE],
  ["severe", "Under federal law, harassment must be severe or pervasive.", PASS],
  ["severe", "Under Title VII, the conduct must be severe or pervasive.", PASS],
  ["severe", "New York no longer requires harassment to be severe or pervasive.", PASS],
  ["severe", "The NYSHRL does not require that harassment be severe or pervasive.", PASS],
  ["severe", "The 2019 amendment removed the severe or pervasive requirement.", PASS],

  // 12. FMLA liquidated damages tied to willfulness
  ["fmlaLiq", "Under the FMLA, liquidated damages are available only if the violation was willful.", FIRE],
  ["fmlaLiq", "FMLA plaintiffs can recover liquidated damages in cases of willful violations.", FIRE],
  ["fmlaLiq", "Under the FMLA you may recover back pay and liquidated damages, and you have two years to sue, three if willful.", PASS],
  ["fmlaLiq", "FMLA liquidated damages are presumed unless the employer shows good faith.", PASS],
  ["fmlaLiq", "FMLA claims carry liquidated damages. The deadline is longer if the violation was willful.", PASS],

  // 13. FMLA paid-leave substitution denied
  ["exhaust", "Your employer may not force you to exhaust your paid vacation during FMLA leave.", FIRE],
  ["exhaust", "An employer cannot require you to use up your PTO before FMLA leave starts.", FIRE],
  ["exhaust", "Your employer may not force you to exhaust your vacation before taking Paid Family Leave.", PASS],
  ["exhaust", "Your employer may require you to substitute paid leave for unpaid FMLA leave.", PASS],

  // 14. Paid Family Leave taken to court
  ["pflCourt", "You can take a Paid Family Leave claim to court.", FIRE],
  ["pflCourt", "Employees can enforce Paid Family Leave rights in court.", FIRE],
  ["pflCourt", "Paid Family Leave benefit disputes go to arbitration, not to court.", PASS],
  ["pflCourt", "Paid Family Leave disputes are resolved through arbitration.", PASS],

  // 15. Arbitration of sexual harassment without EFAA (whole body)
  ["efaa", "Your employment contract may require arbitration of sexual harassment claims.", FIRE],
  ["efaa", "Since 2022, the Ending Forced Arbitration of Sexual Assault and Sexual Harassment Act lets you avoid arbitration.", PASS],
  ["efaa", "Sexual harassment claims can be heard in court instead of arbitration.", PASS],
  ["efaa", "Wage claims may be subject to arbitration.", PASS],

  // 16. Placeholders
  ["placeholder", "[PLACEHOLDER, Results, Replace before publishing]", FIRE],
  ["placeholder", "“[PLACEHOLDER] They did not overpromise.”", FIRE],
  ["placeholder", "Replace before publishing", FIRE],
  ["placeholder", "We replace outdated figures before we publish anything.", PASS],

  // 17. Schema in body
  ["schema", "<script type=\"application/ld+json\">{\"@context\": \"https://schema.org\"}</script>", FIRE],
  ["schema", "{ \"@context\": \"https://schema.org\", \"@type\": \"FAQPage\" }", FIRE],
  ["schema", "Structured data gives search engines context about the page.", PASS],

  // 18. Old NYC sick leave date
  ["sick2014", "Employees began accruing sick time on September 30, 2014.", FIRE],
  ["sick2014", "Accrual began Sept. 30, 2014 for existing employees.", FIRE],
  ["sick2014", "The NYC sick leave law took effect on April 1, 2014.", PASS],

  // 11.7 a. NYSHRL employer-size threshold
  ["nyshrlSize", "The NYSHRL applies to employers with four or more employees.", FIRE],
  ["nyshrlSize", "Under the New York State Human Rights Law, employers with at least four employees are covered.", FIRE],
  ["nyshrlSize", "The NYSHRL and NYCHRL apply to employers with four or more employees.", FIRE],
  ["nyshrlSize", "The Human Rights Law applies to employers with 4 or more employees.", FIRE],
  ["nyshrlSize", "The NYCHRL applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "The New York City Human Rights Law applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "The NYC Human Rights Law applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "The NYSHRL applies to all employers regardless of size. The NYCHRL applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "The NYSHRL applies to all employers, while the NYCHRL applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "Protections come from the New York State Human Rights Law and the New York City Human Rights Law, or NYCHRL, which applies to employers with four or more employees.", PASS],
  ["nyshrlSize", "The ADEA applies to employers with 20 or more employees.", PASS],
  ["nyshrlSize", "Gender is a protected class under federal, New York state, and New York City law.", PASS],

  // 11.7 b. Firm representing employers
  ["firmEmployers", "Katz Melinger represents employers in wage disputes.", FIRE],
  ["firmEmployers", "Our attorneys represent both employees and employers.", FIRE],
  ["firmEmployers", "The firm does not represent employers.", PASS],
  ["firmEmployers", "Katz Melinger represents employees, not employers.", PASS],
  ["firmEmployers", "The firm represents employees only and does not defend employers on employment matters.", PASS],
  ["firmEmployers", "Some employment attorneys represent both employees and employers.", PASS],
  ["firmEmployers", "The firm never defends employers.", PASS],

  // 11.7 c. FMLA + EEOC: critical only when routed, review otherwise
  ["fmlaEeocFiled", "FMLA claims are filed with the EEOC under Title VII.", FIRE],
  ["fmlaEeocFiled", "You can file an FMLA complaint with the EEOC.", FIRE],
  ["fmlaEeocFiled", "The EEOC enforces the FMLA.", FIRE],
  ["fmlaEeocFiled", "FMLA claims are not filed with the EEOC.", PASS],
  ["fmlaEeocFiled", "You were fired after requesting FMLA leave or filing a charge with the EEOC.", PASS],
  ["fmlaEeocFiled", "New Jersey employees may file with the New Jersey Division on Civil Rights within 180 days or file directly in court within two years.", PASS],
  ["fmlaEeocReview", "You were fired after requesting FMLA leave or filing a charge with the EEOC.", FIRE],
  ["fmlaEeocReview", "FMLA claims are filed with the EEOC under Title VII.", PASS], // critical tier instead
  ["fmlaEeocReview", "FMLA claims are not filed with the EEOC.", PASS],
  ["fmlaEeocReview", "The EEOC deadline is 300 days. FMLA leave is unpaid.", PASS],
  ["fmlaEeocReview", "Protected activity includes filing charges with the EEOC or the New York State Division of Human Rights and taking FMLA leave.", PASS],

  // 11.7 c. FMLA + Title VII
  ["fmlaT7Filed", "FMLA claims are filed with the EEOC under Title VII.", FIRE],
  ["fmlaT7Filed", "Your FMLA rights arise under Title VII.", FIRE],
  ["fmlaT7Filed", "The FMLA is part of Title VII.", FIRE],
  ["fmlaT7Filed", "The FMLA is not part of Title VII.", PASS],
  ["fmlaT7Filed", "Federal laws like Title VII, the ADA, and the FMLA protect you.", PASS],
  ["fmlaT7Review", "If you took FMLA leave and then faced sex discrimination under Title VII, talk to a lawyer.", FIRE],
  ["fmlaT7Review", "FMLA claims are filed with the EEOC under Title VII.", PASS], // critical tier instead
  ["fmlaT7Review", "Federal laws like Title VII, the ADA, and the FMLA protect you.", PASS],
  ["fmlaT7Review", "The firm handles claims under Title VII, the New York State Human Rights Law, the FMLA, and the ADA.", PASS],
  ["fmlaT7Review", "Title VII bans sex discrimination. The FMLA provides unpaid leave.", PASS],
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let failures = 0;

// Hygiene: every regex compiles, and no \b was turned into a backspace
// character somewhere between this file and the database.
for (const [key, t] of Object.entries(T)) {
  if (t.pattern.includes("\u0008")) {
    failures++;
    console.log(`FAIL [${key}] pattern contains a literal backspace (0x08): a \\b was mangled`);
  }
  if (t.matchType === "regex") {
    try {
      new RegExp(t.pattern, "gi");
    } catch (e) {
      failures++;
      console.log(`FAIL [${key}] invalid regex: ${(e as Error).message}`);
    }
  }
}

const perTrap = new Map<string, { pass: number; fail: number }>();
for (const [key, text, expected] of cases) {
  const hits = matchTrap(T[key], text);
  const fired = hits.length > 0;
  const ok = fired === expected;
  const tally = perTrap.get(key) ?? { pass: 0, fail: 0 };
  if (ok) tally.pass++;
  else {
    tally.fail++;
    failures++;
    console.log(
      `FAIL [${key}] expected ${expected ? "FIRE" : "PASS"}, got ${fired ? "FIRE" : "PASS"}: ${text}` +
        (fired ? `\n     excerpt: ${hits[0].excerpt}` : ""),
    );
  }
  perTrap.set(key, tally);
}

// Every trap must have at least one FIRE and one PASS case.
for (const key of Object.keys(T) as Key[]) {
  const fires = cases.filter(([k, , e]) => k === key && e).length;
  const passes = cases.filter(([k, , e]) => k === key && !e).length;
  if (!fires || !passes) {
    failures++;
    console.log(`FAIL [${key}] needs at least one FIRE and one PASS case (has ${fires}/${passes})`);
  }
}

for (const [key, { pass, fail }] of perTrap) {
  console.log(`${fail ? "x" : "ok"}  ${key.padEnd(16)} ${pass}/${pass + fail}  (${T[key as Key].severity})`);
}
console.log(`\n${cases.length} cases, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
