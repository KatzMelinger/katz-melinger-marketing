/**
 * Shared attorney-advertising compliance core.
 *
 * Both the ad-copy checker (lib/ads-compliance.ts) and the general outbound-
 * content checker (lib/content-compliance.ts) build on this: the same data-
 * driven NY/NJ (+ any seeded jurisdiction) rule set, the same disclaimer
 * library, and the same result shape. Keeping the rule loading and the shared
 * rule text here means a rule change is applied identically to ads, blog posts,
 * emails, social, GBP replies, and community responses.
 */

import {
  getDisclaimersForJurisdictions,
  getRulesForJurisdictions,
} from "@/lib/compliance-rules-store";
import { AD_TERMS_RULE } from "@/lib/ad-terms";
import { FEE_LANGUAGE_RULE } from "@/lib/fee-language";
import { FIRM_FACTS_RULE } from "@/lib/firm-facts";

// Any jurisdiction code (or comma-separated list, e.g. "NY,NJ") now that rules
// are data-driven. Kept as a string alias for back-compat with call sites.
export type Jurisdiction = string;

export interface ComplianceViolation {
  rule: string; // e.g. "NY 22 NYCRR §1200 RPC 7.1(a)"
  severity: "high" | "medium" | "low";
  excerpt: string; // the offending text
  reason: string; // why it's a problem
  fix: string; // concrete suggested replacement
}

/** Fields every compliance review returns, regardless of surface. */
export interface BaseComplianceResult {
  score: number; // 0-100
  status: "compliant" | "needs_changes" | "non_compliant";
  violations: ComplianceViolation[];
  warnings: string[]; // soft issues / best practices
  requiredDisclaimers: string[];
  summary: string;
}

// The jurisdiction-specific rules block. Used as the fallback when the database
// has no rules for the requested jurisdiction(s) — preserves the original
// NY/NJ behavior so the checker never regresses.
export const DEFAULT_RULES = `NEW YORK (22 NYCRR Part 1200 — Rules of Professional Conduct):
- RPC 7.1(a): No false, deceptive, or misleading statements. No comparative claims (e.g. "best lawyer," "#1") that cannot be factually substantiated.
- RPC 7.1(b)(2): Computer-accessed communications (i.e., online ads) must include the words "Attorney Advertising" on the first page or home page, OR the label must be clearly disclosed.
- RPC 7.1(d): If a communication mentions specific case results, it must include a prominent disclaimer that prior results do not guarantee a similar outcome.
- RPC 7.1(e): Endorsements/testimonials require a disclaimer that they are paid (if so) and that results vary.
- RPC 7.4: Cannot claim to be a "specialist" or "expert" unless certified by an ABA-accredited or NYS-recognized organization (and Katz Melinger is not so certified — assume "no").

NEW JERSEY (RPC 7.1-7.5 + Committee on Attorney Advertising Opinions):
- RPC 7.1(a): No false or misleading communication. Same superlative ban as NY.
- RPC 7.1(a)(3): No "predictions of success" or guarantees of results.
- RPC 7.4(a): Cannot use "specialist," "specializing," or "expert" without certification by the NJ Supreme Court or ABA-accredited body.
- Opinion 39: Bona fide office requirement — communications should not imply offices in jurisdictions where the firm has none.`;

// Failure modes shared across every surface. The model must flag these as
// violations regardless of whether the content is an ad, a blog post, an
// email, a social post, or a public reply.
export const COMMON_FAILURE_MODES = `COMMON FAILURE MODES YOU MUST FLAG (high severity):
1. Superlatives or self-aggrandizement: "best," "top," "#1," "leading," "most experienced," "premier," "elite," "winningest"
2. Result guarantees: "we'll win your case," "guaranteed recovery," "we will get you compensation"
3. Specific dollar results or case outcomes without a prior-results disclaimer
4. "Specialist" / "expert" / "specializing in" without certification disclosure
5. Testimonials or client praise without a "results vary" disclaimer
6. Missing "Attorney Advertising" label where the surface requires it
7. Implying personal endorsement by judges or government bodies
8. Solicitation that violates RPC 7.3 (targeting prospective clients improperly)
9. Statements that could be read as legal advice / creating an attorney-client relationship without an appropriate disclaimer
10. ${FEE_LANGUAGE_RULE}

${AD_TERMS_RULE}

${FIRM_FACTS_RULE}`;

// Sept 28 spec 11.4: this check reads for ATTORNEY ADVERTISING rules only. It
// does not verify the law, and it said "provides accurate legal information"
// and "ready to publish" on drafts with wrong deadlines, which a reviewer
// reasonably read as a legal sign-off. The legal layer (traps, knowledge base,
// statute table, authority loop) is the only thing that speaks to accuracy.
export const SCOPE_NOTE = `SCOPE: You judge attorney advertising and firm rules ONLY. You do NOT check whether the law stated is correct.
Never write that the content is legally accurate, correct, or contains accurate legal information, and never say it is "ready to publish" —
other checks and an attorney decide that. Describe only the advertising findings.
Describing the remedies a STATUTE provides (back pay, reinstatement, liquidated damages, attorney fee recovery) is legal
information, not a claim about the firm's past results, and does not require a prior results disclaimer. Require that
disclaimer only where the firm's own results, settlements, verdicts or client outcomes are mentioned.
Only list real violations. If something is permitted, do not list it at all.`;

export const SCORE_GUIDE = `${SCOPE_NOTE}

Score guide (attorney advertising compliance only):
- 90-100: no advertising issues beyond minor warnings
- 70-89: acceptable once the listed disclaimers are added
- 40-69: needs material rewrites
- 0-39: non-compliant — must be rewritten`;

/** Strip a model-written claim of legal accuracy from a compliance summary. */
export function scrubAccuracyClaims(summary: string): string {
  return summary
    .replace(/[^.]*\b(?:accurate|correct)\s+legal\s+(?:information|content|statements?)[^.]*\.\s*/gi, "")
    .replace(/[^.]*\bready\s+(?:to|for)\s+publish(?:ing|ed)?\b[^.]*\.\s*/gi, "")
    .trim();
}

/**
 * Build the jurisdiction-specific rules + disclaimers blocks from the database
 * for the requested jurisdiction(s). Falls back to the hard-coded NY/NJ rules
 * if the DB has no matching rows or is unreachable — so the checker never
 * regresses or errors on a jurisdiction that hasn't been seeded yet.
 */
export async function loadComplianceRuleBlocks(
  jurisdiction: string,
): Promise<{ rulesBlock: string; disclaimersBlock: string }> {
  const codes = jurisdiction
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    const [rules, disclaimers] = await Promise.all([
      getRulesForJurisdictions(codes),
      getDisclaimersForJurisdictions(codes),
    ]);

    const rulesBlock = rules.length
      ? rules
          .map((r) => {
            const header = `${r.jurisdiction_name.toUpperCase()}${
              r.governing_authority ? ` (${r.governing_authority})` : ""
            }:`;
            const summary = r.rules_summary ? `\n${r.rules_summary}` : "";
            const keyRules = r.key_rules.length
              ? "\n" +
                r.key_rules
                  .map(
                    (k) =>
                      `- ${k.citation ? `${k.citation}: ` : ""}${k.rule}${
                        k.severity ? ` [${k.severity}]` : ""
                      }`,
                  )
                  .join("\n")
              : "";
            const reqLabel = r.required_label
              ? `\n- Required label/disclosure: "${r.required_label}"`
              : "";
            return `${header}${summary}${keyRules}${reqLabel}`;
          })
          .join("\n\n")
      : DEFAULT_RULES;

    const disclaimersBlock = disclaimers.length
      ? `\nFIRM DISCLAIMER LIBRARY — require the relevant ones verbatim when their trigger applies:\n` +
        disclaimers
          .map(
            (d) =>
              `- "${d.label}"${d.trigger ? ` (when ${d.trigger})` : ""}: ${d.text}`,
          )
          .join("\n") +
        "\n"
      : "";

    return { rulesBlock, disclaimersBlock };
  } catch (err) {
    console.warn("[compliance-core] Rule load failed, using defaults:", err);
    return { rulesBlock: DEFAULT_RULES, disclaimersBlock: "" };
  }
}

/**
 * Normalize a raw model result into a safe BaseComplianceResult (clamps the
 * score, defaults arrays, derives a status if the model omitted one).
 */
/**
 * A "violation" the model itself says is fine. Seen live 2026-09-30: "This
 * language correctly describes attorney fee recovery as a legal remedy... This
 * is permitted and should remain. No violation." filed at high severity, which
 * held a correct draft. A note that clears the text is not a violation.
 */
function isSelfClearingNote(v: { reason?: unknown; rule?: unknown }): boolean {
  const t = `${typeof v.rule === "string" ? v.rule : ""} ${typeof v.reason === "string" ? v.reason : ""}`;
  return /\bno violation\b|\bis permitted and should remain\b|\bnot a violation\b|\bno (?:change|action) (?:is )?(?:needed|required)\b|\bthis is (?:compliant|acceptable|fine)\b/i.test(t);
}

export function normalizeComplianceResult(
  raw: Partial<BaseComplianceResult> | null | undefined,
): BaseComplianceResult {
  const violations = (Array.isArray(raw?.violations) ? raw!.violations : []).filter((v) => !isSelfClearingNote(v));
  const score = Math.max(0, Math.min(100, Math.round(Number(raw?.score ?? 0))));
  const status: BaseComplianceResult["status"] =
    raw?.status === "compliant" ||
    raw?.status === "needs_changes" ||
    raw?.status === "non_compliant"
      ? raw.status
      : violations.some((v) => v.severity === "high") || score < 40
        ? "non_compliant"
        : score < 90
          ? "needs_changes"
          : "compliant";

  return {
    score,
    status,
    violations,
    warnings: Array.isArray(raw?.warnings) ? raw!.warnings : [],
    requiredDisclaimers: Array.isArray(raw?.requiredDisclaimers)
      ? raw!.requiredDisclaimers
      : [],
    // Belt and braces with SCOPE_NOTE: the prompt says not to claim legal
    // accuracy, and this removes the sentence if the model does anyway.
    summary: typeof raw?.summary === "string" ? scrubAccuracyClaims(raw.summary) : "",
  };
}
