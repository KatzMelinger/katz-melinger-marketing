/**
 * The internal link map (Diana's Sept 28 spec, Appendix E): the only source of
 * internal links a draft may use. Full URLs, verified live by Diana on
 * 2026-09-28. Never shorten to a slug, never invent a URL, and never link
 * /recover-attorney-fees-debt-collection/ (it is about fees).
 */

export type LinkMapRow = {
  id: string;
  label: string;
  /** Topic words that route a draft to this row (lowercase, any may match). */
  match: RegExp;
  pillar: { url: string; anchor: string };
  supporting: { url: string; anchor: string }[];
};

const B = "https://katzmelinger.com";

export const LINK_MAP: LinkMapRow[] = [
  {
    id: "overtime",
    label: "Overtime, exempt versus nonexempt, salaried overtime",
    match: /\bovertime\b|\bexempt\b|\bsalaried\b/i,
    pillar: { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/wage-and-hour-laws-ny-ensuring-fair-overtime-compensation/`, anchor: "overtime pay under New York wage and hour law" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/`, anchor: "wage and hour claims for employees" },
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/unpaid_wage_cases/`, anchor: "unpaid wage cases" },
    ],
  },
  {
    id: "wage-hour",
    label: "Wage and hour",
    match: /\bwage|\bpaycheck|\btip(s|ped| pool)|\bminimum wage|\bdeduction|\bsick (pay|leave)|\blunch break/i,
    pillar: { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/`, anchor: "wage and hour claims for employees" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/unpaid_wage_cases/`, anchor: "unpaid wage cases" },
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/new-york-tip-pooling-tip-sharing-rules/`, anchor: "New York tip pooling and tip sharing rules" },
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/am-i-entitled-to-a-lunch-break-in-new-york-new-jersey-and-under-federal-law/`, anchor: "lunch break rules in New York and New Jersey" },
    ],
  },
  {
    id: "sexual-harassment",
    label: "Sexual harassment, quid pro quo",
    match: /\bsexual harassment\b|\bquid pro quo\b/i,
    pillar: { url: `${B}/practice-areas/employment-law/sexual-harassment/`, anchor: "sexual harassment claims" },
    supporting: [
      { url: `${B}/blog/2023/06/understanding-quid-pro-quo-sexual-harassment/`, anchor: "quid pro quo sexual harassment" },
      { url: `${B}/new-york-hostile-work-environment-lawyer/`, anchor: "hostile work environment claims" },
      { url: `${B}/practice-areas/employment-law/retaliation/`, anchor: "retaliation claims" },
    ],
  },
  {
    id: "hostile-work-environment",
    label: "Hostile work environment, workplace or job harassment",
    match: /\bhostile work environment\b|\bharass/i,
    pillar: { url: `${B}/new-york-hostile-work-environment-lawyer/`, anchor: "hostile work environment claims" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/discrimination/`, anchor: "workplace discrimination claims" },
      { url: `${B}/practice-areas/employment-law/sexual-harassment/`, anchor: "sexual harassment claims" },
    ],
  },
  {
    id: "fmla",
    label: "FMLA, Paid Family Leave, medical leave",
    match: /\bFMLA\b|\bfamily (and medical )?leave\b|\bmedical leave\b|\bpaid family leave\b/i,
    pillar: { url: `${B}/practice-areas/employment-law/fmla-violations/`, anchor: "FMLA violations" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/fmla-violations/can-you-be-laid-off-while-on-fmla-leave-in-ny-and-nj/`, anchor: "being laid off while on FMLA leave" },
      { url: `${B}/new-york-leave-and-accommodation-violations-lawyer/`, anchor: "leave and accommodation violations" },
      { url: `${B}/practice-areas/employment-law/retaliation/`, anchor: "retaliation claims" },
    ],
  },
  {
    id: "disability",
    label: "Disability, ADA, reasonable accommodation",
    match: /\bdisabilit|\bADA\b|\baccommodation/i,
    pillar: { url: `${B}/new-york-leave-and-accommodation-violations-lawyer/`, anchor: "leave and accommodation violations" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/discrimination/`, anchor: "workplace discrimination claims" },
      { url: `${B}/practice-areas/employment-law/fmla-violations/`, anchor: "FMLA violations" },
    ],
  },
  {
    id: "retaliation",
    label: "Retaliation, whistleblower, fired for complaining",
    match: /\bretaliat|\bwhistleblow|\bfired for complaining\b/i,
    pillar: { url: `${B}/practice-areas/employment-law/retaliation/`, anchor: "retaliation claims" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wrongful-termination/`, anchor: "wrongful termination claims" },
      { url: `${B}/practice-areas/employment-law/discrimination/`, anchor: "workplace discrimination claims" },
    ],
  },
  {
    id: "discrimination",
    label: "Discrimination (any protected class)",
    match: /\bdiscriminat|\bprotected class\b|\bgender\b|\bpregnan|\bage\b|\brace\b|\breligio/i,
    pillar: { url: `${B}/practice-areas/employment-law/discrimination/`, anchor: "workplace discrimination claims" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/retaliation/`, anchor: "retaliation claims" },
      { url: `${B}/new-york-hostile-work-environment-lawyer/`, anchor: "hostile work environment claims" },
    ],
  },
  {
    id: "severance",
    label: "Severance",
    match: /\bseverance\b/i,
    pillar: { url: `${B}/practice-areas/employment-law/wrongful-termination/when-shouldnt-you-sign-a-ny-severance-agreement/`, anchor: "when not to sign a severance agreement" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wrongful-termination/`, anchor: "wrongful termination claims" },
      { url: `${B}/blog/2023/03/new-ruling-limits-confidentiality-in-severance-agreements/`, anchor: "limits on confidentiality in severance agreements" },
    ],
  },
  {
    id: "non-compete",
    label: "Non compete",
    match: /\bnon[-\s]?compet|\brestrictive covenant/i,
    pillar: { url: `${B}/practice-areas/employment-law/what-is-a-non-compete-agreement/`, anchor: "non compete agreements" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wrongful-termination/when-shouldnt-you-sign-a-ny-severance-agreement/`, anchor: "when not to sign a severance agreement" },
      { url: `${B}/practice-areas/employment-law/`, anchor: "employment law" },
    ],
  },
  {
    id: "wrongful-termination",
    label: "Wrongful termination, wrongful dismissal",
    match: /\bwrongful(ly)? (termination|dismissal|discharge|fired)\b|\bfired\b|\bterminat/i,
    pillar: { url: `${B}/practice-areas/employment-law/wrongful-termination/`, anchor: "wrongful termination claims" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/retaliation/`, anchor: "retaliation claims" },
      { url: `${B}/practice-areas/employment-law/wrongful-termination/when-shouldnt-you-sign-a-ny-severance-agreement/`, anchor: "when not to sign a severance agreement" },
    ],
  },
  {
    id: "judgment-enforcement",
    label: "Judgment enforcement",
    match: /\bjudgment\b|\bdomesticat|\brestraining notice|\blevy\b/i,
    pillar: { url: `${B}/practice-areas/civil-litigation/judgment-collection/`, anchor: "judgment enforcement" },
    supporting: [
      { url: `${B}/enforce-out-of-state-judgment-new-york/`, anchor: "enforcing an out of state judgment in New York" },
      { url: `${B}/practice-areas/civil-litigation/domesticating-judgments-in-ny-step-by-step-guide/`, anchor: "domesticating a judgment in New York" },
      { url: `${B}/practice-areas/assets-levied-business-judgment-ny/`, anchor: "assets that can be levied on a business judgment" },
    ],
  },
  {
    id: "collections",
    label: "Commercial collections",
    match: /\bcollect|\bdebt\b|\bunpaid invoice|\bcreditor|\breceivable/i,
    pillar: { url: `${B}/practice-areas/civil-litigation/new-york-commercial-collections-attorney/`, anchor: "commercial collections" },
    supporting: [
      { url: `${B}/resources/oral-vs-written-contracts-ny-collections/`, anchor: "oral versus written contracts in collections" },
      { url: `${B}/practice-areas/civil-litigation/judgment-collection/`, anchor: "judgment enforcement" },
      { url: `${B}/practice-areas/assets-levied-business-judgment-ny/`, anchor: "assets that can be levied on a business judgment" },
    ],
  },
  {
    id: "employment-general",
    label: "General employment lawyer",
    match: /\bemploy/i,
    pillar: { url: `${B}/practice-areas/employment-law/`, anchor: "employment law" },
    supporting: [
      { url: `${B}/practice-areas/employment-law/wage-hour-claims-employees/`, anchor: "wage and hour claims for employees" },
      { url: `${B}/practice-areas/employment-law/discrimination/`, anchor: "workplace discrimination claims" },
    ],
  },
];

/** Pick the link map row for a draft by its title/topic/keyword (most specific row first). */
export function linkRowFor(text: string): LinkMapRow | null {
  return LINK_MAP.find((r) => r.match.test(text)) ?? null;
}
