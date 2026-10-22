/**
 * Scores explain themselves (Oct 20 spec, Task A11): every score opens a
 * breakdown that lists each point lost, the reason and the check that fixes
 * it. Example: "SEO 57: keyword missing from meta title (minus 10); 1 internal
 * link, 3 required (minus 15); no FAQ section (minus 18)."
 *
 * SEO and CASH are weighted sums of their parts, so a part's points lost are
 * its weight times what it is short of 100. AEO and readability record their
 * own deductions; brand voice and linkability are scored by a model asked to
 * itemize them. Whatever a scorer did not itemize (an analysis from before
 * this was built) is shown as one "not itemized" line rather than guessed.
 *
 * Scores stay information only; Task A10 reports whether each one predicts
 * results. Kept free of server imports: the analysis card renders it.
 */
import type { ScoreDeduction } from "./content-analysis";

export type { ScoreDeduction };

type SeoParts = { titleQuality: number; headingStructure: number; keywordPlacement: number; authorityLinks: number; contentDepth: number; schemaReadiness: number };
type CashParts = { conversationalAuthority: number; answerCompleteness: number; sourceExpertise: number; humanAttribution: number };

/** What the breakdown reads: a stored analysis, old or new (the fields added for Task A11 are optional). */
export type BreakdownInput = {
  seo_score?: number | null;
  seo_breakdown?: SeoParts | null;
  seo_findings?: string[];
  aeo_score: number;
  aeo_findings?: string[];
  aeo_deductions?: ScoreDeduction[];
  cash_score: number | null;
  cash_breakdown?: CashParts | null;
  readability_score: number;
  readability_rules?: { applicable: number; failed: { id: string; label: string }[] };
  brand_voice_score: number | null;
  brand_voice_findings?: string[];
  brand_voice_deductions?: ScoreDeduction[];
  linkability_score: number | null;
  linkability_findings?: string[];
  linkability_deductions?: ScoreDeduction[];
};

export type ScoreKey = "seo" | "aeo" | "cash" | "readability" | "brand_voice" | "linkability";

/** The named check each deduction links to, and whether Improve to Ready fixes it. */
export const CHECKS: Record<string, { label: string; fixable: boolean }> = {
  keyword_placement: { label: "Keyword placement (Task A8)", fixable: true },
  direct_answer: { label: "Direct answer (Task A8)", fixable: true },
  faq: { label: "FAQ section (Task A8)", fixable: true },
  signs: { label: "Signs list (Task A8)", fixable: true },
  internal_links: { label: "Internal links (Task A8)", fixable: true },
  schema: { label: "FAQ schema (Task A8)", fixable: true },
  search_intent: { label: "Search intent (Task A8)", fixable: false },
  topic_coverage: { label: "Topic coverage (Task A8)", fixable: true },
  title: { label: "Title length and keyword", fixable: true },
  headings: { label: "Heading structure", fixable: true },
  sources: { label: "Sources (Task A7)", fixable: true },
  byline: { label: "Reviewed by byline (Task A2)", fixable: false },
  readability: { label: "Readability rules", fixable: true },
  brand_voice: { label: "Brand voice", fixable: false },
  linkability: { label: "Linkability", fixable: false },
};

export type BreakdownLine = { points: number; reason: string; check: string | null; checkLabel: string | null; fixable: boolean };
export type ScoreBreakdownData = { key: ScoreKey; label: string; score: number | null; lines: BreakdownLine[]; summary: string };

const line = (points: number, reason: string, check: string | null): BreakdownLine => ({
  points: Math.round(points * 10) / 10,
  reason,
  check,
  checkLabel: check ? (CHECKS[check]?.label ?? check) : null,
  fixable: check ? (CHECKS[check]?.fixable ?? false) : false,
});

/** The rest of the gap, when the itemized lines do not reach 100 minus the score. */
function remainder(score: number | null, lines: BreakdownLine[], what: string): BreakdownLine[] {
  if (score == null) return lines;
  const gap = Math.round((100 - score - lines.reduce((n, l) => n + l.points, 0)) * 10) / 10;
  return Math.abs(gap) >= 1 ? [...lines, line(gap, what, null)] : lines;
}

function findingsFor(findings: string[], re: RegExp): string {
  const hit = findings.filter((f) => re.test(f));
  return hit.length ? `: ${hit.join(" ")}` : "";
}

const SEO_PARTS: { key: keyof SeoParts; weight: number; label: string; check: string; re: RegExp }[] = [
  { key: "titleQuality", weight: 0.18, label: "Title", check: "title", re: /\btitle\b/i },
  { key: "headingStructure", weight: 0.15, label: "Headings", check: "headings", re: /\bH[123]\b|heading/i },
  { key: "keywordPlacement", weight: 0.22, label: "Keyword placement", check: "keyword_placement", re: /keyword/i },
  { key: "authorityLinks", weight: 0.18, label: "Authority links and citations", check: "sources", re: /\.gov|statute|citation/i },
  { key: "contentDepth", weight: 0.17, label: "Content depth", check: "topic_coverage", re: /words|depth|short|long/i },
  { key: "schemaReadiness", weight: 0.1, label: "Schema readiness", check: "schema", re: /schema|structured data/i },
];

const CASH_PARTS: { key: keyof CashParts; weight: number; label: string; check: string }[] = [
  { key: "conversationalAuthority", weight: 0.22, label: "Conversational authority", check: "direct_answer" },
  { key: "answerCompleteness", weight: 0.3, label: "Answer completeness", check: "faq" },
  { key: "sourceExpertise", weight: 0.3, label: "Source expertise", check: "sources" },
  { key: "humanAttribution", weight: 0.18, label: "Human attribution", check: "byline" },
];

const fromDeductions = (d: ScoreDeduction[] | undefined, fallbackCheck: string) => (d ?? []).map((x) => line(x.points, x.reason, x.check ?? fallbackCheck));

export function scoreBreakdowns(a: BreakdownInput): ScoreBreakdownData[] {
  const out: ScoreBreakdownData[] = [];

  // SEO.
  const seo = a.seo_breakdown;
  const seoScore = a.seo_score ?? null;
  const seoLines = seo
    ? SEO_PARTS.filter((p) => (seo[p.key] ?? 100) < 100).map((p) =>
        line(p.weight * (100 - seo[p.key]), `${p.label} ${seo[p.key]}/100${findingsFor(a.seo_findings ?? [], p.re)}`, p.check),
      )
    : [];
  out.push({ key: "seo", label: "SEO", score: seoScore, lines: remainder(seoScore, seoLines, "Rounding"), summary: "" });

  // AEO.
  const aeoLines = a.aeo_deductions ? fromDeductions(a.aeo_deductions, "topic_coverage") : [];
  out.push({
    key: "aeo",
    label: "AEO",
    score: a.aeo_score,
    lines: a.aeo_deductions ? remainder(a.aeo_score, aeoLines, "Rounding") : remainder(a.aeo_score, [], `Not itemized (analysis from before Task A11): ${(a.aeo_findings ?? []).slice(0, 3).join(" ")}`),
    summary: "",
  });

  // CASH.
  const cash = a.cash_breakdown;
  const cashLines =
    a.cash_score != null && cash
      ? CASH_PARTS.filter((p) => (cash[p.key] ?? 100) < 100).map((p) => line(p.weight * (100 - cash[p.key]), `${p.label} ${cash[p.key]}/100`, p.check))
      : [];
  out.push({ key: "cash", label: "CASH", score: a.cash_score, lines: remainder(a.cash_score, cashLines, "Rounding, or the source cap for an open legal finding"), summary: "" });

  // Readability: each failed rule costs an equal share of the applicable rules.
  const rr = a.readability_rules;
  const readLines = rr && rr.applicable > 0 ? rr.failed.map((f) => line(100 / rr.applicable, f.label, "readability")) : [];
  out.push({
    key: "readability",
    label: "Readability",
    score: a.readability_score,
    lines: rr ? remainder(a.readability_score, readLines, "Rounding") : remainder(a.readability_score, [], "Not itemized (analysis from before Task A11, or the Flesch score)"),
    summary: rr ? `${rr.applicable - rr.failed.length} of ${rr.applicable} rules pass; each rule is worth ${Math.round((100 / Math.max(1, rr.applicable)) * 10) / 10} points.` : "",
  });

  // Brand voice and linkability: the model's itemized deductions.
  for (const [key, label, score, d, findings] of [
    ["brand_voice", "Brand voice", a.brand_voice_score, a.brand_voice_deductions, a.brand_voice_findings],
    ["linkability", "Linkability", a.linkability_score, a.linkability_deductions, a.linkability_findings],
  ] as const) {
    const lines = d ? remainder(score, fromDeductions(d, key), "Not itemized by the model") : remainder(score, [], `Not itemized: ${(findings ?? []).slice(0, 3).join(" ")}`);
    out.push({ key, label, score, lines, summary: "" });
  }

  for (const b of out) {
    b.lines.sort((x, y) => y.points - x.points);
    if (!b.summary && b.score != null) {
      b.summary = `${b.label} ${b.score}: ${b.lines
        .slice(0, 4)
        .map((l) => `${l.reason.split(":")[0].toLowerCase()} (minus ${Math.round(l.points)})`)
        .join("; ")}${b.lines.length > 4 ? "; …" : ""}.`;
    }
  }
  return out;
}
