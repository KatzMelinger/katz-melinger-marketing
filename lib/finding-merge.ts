/**
 * Fewer, better flags (Oct 6 spec, Task 25). Applied to every set of findings
 * before it is written (lib/content-findings-store.ts syncFindings), so the
 * full analysis, the approval gate and the social gate all agree.
 *
 * 1. Style findings are not review items. Brand voice, readability, SEO, AEO,
 *    CASH, linkability and structure are scores and suggestions: generation
 *    already fixes what can be fixed safely (readability remediation, the
 *    brand rules in lib/auto-rewrite.ts), and the rest is information. They
 *    are never stored as open findings and never reach Needs a decision. The
 *    one exception is SEO cannibalization, a real duplicate-content risk.
 *
 * 2. One sentence, one finding. Every finding that quotes the same sentence is
 *    merged into one that lists each rule that raised it. The most severe
 *    decides how it is handled; it keeps that finding's fingerprint, so its
 *    status (dismissed, approved as is) carries over.
 *
 * Pure: no IO.
 */
import { SOURCE_LABEL, type FindingSeverity, type FindingSource, type NormalizedFinding } from "./content-findings";
import { isQuoteFinding, quoteText } from "./finding-currency";

export const STYLE_SOURCES: ReadonlySet<FindingSource> = new Set<FindingSource>([
  "readability",
  "brand_voice",
  "seo",
  "aeo",
  "cash",
  "linkability",
  "structure",
]);

export function isStyleFinding(f: { source: string; ruleId: string | null }): boolean {
  if (f.source === "seo" && f.ruleId === "cannibalization") return false;
  return STYLE_SOURCES.has(f.source as FindingSource);
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, important: 1, advisory: 2 };
const SOURCE_RANK: Partial<Record<FindingSource, number>> = { legal: 0, freshness: 1, compliance: 2 };

/** The merge key: the quoted sentence, normalized. Null when the finding does not quote one. */
function sentenceKey(f: NormalizedFinding): string | null {
  if (!f.excerpt || !isQuoteFinding(f)) return null;
  const key = quoteText(f.excerpt);
  return key.length >= 20 ? key : null;
}

/** Which of two findings on one sentence leads: most severe, then legal > freshness > compliance. */
function leads(a: NormalizedFinding, b: NormalizedFinding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
}

export type MergedFinding = NormalizedFinding & {
  /** Fingerprints folded into this one; their rows close as merged. */
  mergedFingerprints?: string[];
};

export function mergeSameSentence(findings: readonly NormalizedFinding[]): MergedFinding[] {
  const groups = new Map<string, NormalizedFinding[]>();
  const out: MergedFinding[] = [];
  for (const f of findings) {
    const key = sentenceKey(f);
    if (!key) {
      out.push(f);
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  for (const group of groups.values()) {
    const unique = [...new Map(group.map((f) => [f.fingerprint, f])).values()].sort(leads);
    const [lead, ...rest] = unique;
    if (rest.length === 0) {
      out.push(lead);
      continue;
    }
    const also = rest.map((f) => `${SOURCE_LABEL[f.source]}: ${f.title}`);
    out.push({
      ...lead,
      detail: [lead.detail, `Also raised by: ${also.join("; ")}.`].filter(Boolean).join("\n\n"),
      mergedFingerprints: rest.map((f) => f.fingerprint),
    });
  }
  return out;
}

/** What the sync writes. Style findings out, same-sentence findings merged. */
export function prepareFindings(incoming: readonly NormalizedFinding[]): MergedFinding[] {
  return mergeSameSentence(incoming.filter((f) => !isStyleFinding(f)));
}
