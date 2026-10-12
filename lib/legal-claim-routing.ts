/**
 * Who a legal sentence goes to (Oct 6 spec, Task 25: "attorney routing only
 * for real legal claims").
 *
 * A sentence reaches "Send to attorney" only when it states a legal rule, a
 * deadline, a number, a coverage threshold, or what an employer can or cannot
 * do, AND no rule covers it: no knowledge base figure, no legal_kb_entries
 * topic, no statute table row. A covered sentence is checked automatically by
 * that rule, so an attorney adds nothing; general wording ("you may have
 * rights", "every situation is different") is never a claim at all.
 *
 * This replaces the negative_statement and interpretation categories. They
 * sent a sentence to an attorney for HOW it was phrased ("not", "generally"),
 * which flagged correct general wording. Their sentences now pass through this
 * test like any other.
 */
import { isAnchored } from "./legal-scope";
import { getThresholds, type KbThresholdEntry } from "./legal-knowledge-base";
import { thresholdCovers } from "./legal-value-check";
import { kbEntriesCover, loadLegalKb, type KbEntry } from "./legal-kb";
import { loadStatuteTable } from "./legal-statute-check";
import { compileTable, type StatuteRow } from "./legal-statute-table";

/** Plain-language framing a law firm page uses everywhere. Never a claim. */
const GENERAL_WORDING =
  /\b(?:you )?(?:may|might|could) have (?:legal )?(?:rights|claims?|options|a case|recourse)\b|\bevery (?:situation|case|claim) is (?:different|unique)\b|\b(?:an? )?(?:employment )?(?:attorney|lawyer) can (?:review|help|evaluate|assess|explain|advise)\b|\b(?:speak|talk|consult) (?:with|to) an? (?:experienced )?(?:employment )?(?:attorney|lawyer)\b|\bdepends on the (?:facts|circumstances|details)\b|\bthis (?:article|page|post) is (?:for )?(?:general )?information/i;

/** What an employer can or cannot do. */
const EMPLOYER_RULE =
  /\b(?:employers?|companies|businesses|your (?:boss|employer|company))\b[^.;]{0,60}?\b(?:must(?: not)?|may not|cannot|can't|can not|shall(?: not)?|(?:is|are) (?:not )?(?:required|allowed|permitted|prohibited|barred|forbidden)|(?:has|have) to|(?:is|are) (?:legally )?obligated)\b/i;

/** A rule stated about the law itself. */
const LEGAL_RULE =
  /\b(?:it is|is|are) (?:illegal|unlawful)\b|\b(?:is|are) (?:not )?(?:enforced|administered) by\b|\b(?:law|statute|act|code|regulation|doctrine|NYSHRL|NYCHRL|FLSA|NYLL|Title VII|ADA|ADEA|FMLA|LAD|CEPA|Labor Law)\b[^.;]{0,80}?\b(?:requires?|prohibits?|protects?|bars?|forbids?|entitles?|mandates?|applies to|covers?)\b|\b(?:you|employees?|workers?) (?:are|is) (?:legally )?entitled to\b|\b(?:you|employees?|workers?) (?:must|have to|need to) file\b|\bstatute of limitations\b/i;

/** Does this sentence assert something about the law that could be wrong? */
export function statesLegalClaim(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  const anchored = isAnchored(s);
  if (!anchored && GENERAL_WORDING.test(s)) return false;
  return anchored || EMPLOYER_RULE.test(s) || LEGAL_RULE.test(s);
}

export type ClaimCoverage = {
  thresholds: KbThresholdEntry[];
  kbEntries: KbEntry[];
  statutes: StatuteRow[];
};

/** Is there a rule that already checks this sentence? */
export function ruleCovers(sentence: string, c: ClaimCoverage): boolean {
  if (thresholdCovers(sentence, c.thresholds)) return true;
  if (kbEntriesCover(sentence, c.kbEntries)) return true;
  if (c.statutes.length > 0) {
    for (const { re } of compileTable(c.statutes)) {
      re.lastIndex = 0;
      if (re.test(sentence)) return true;
    }
  }
  return false;
}

/** The rules a draft is checked against, loaded once per run. A failed read
 *  covers nothing, so the claim still reaches a person. */
export async function loadClaimCoverage(tenantId: string): Promise<ClaimCoverage> {
  const [thresholds, kb, statutes] = await Promise.all([
    getThresholds(tenantId).catch(() => [] as KbThresholdEntry[]),
    loadLegalKb(tenantId),
    loadStatuteTable(tenantId),
  ]);
  return {
    thresholds,
    kbEntries: kb.ok ? kb.entries : [],
    statutes: statutes.ok ? statutes.rows : [],
  };
}
