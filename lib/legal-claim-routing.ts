/**
 * Who a legal sentence goes to (Oct 6 spec, Task 25: "attorney routing only
 * for real legal claims").
 *
 * A sentence reaches "Send to attorney" only when it states a legal rule, a
 * deadline, a number, a coverage threshold, or what an employer can or cannot
 * do, AND no rule covers it: no knowledge base figure, no legal_kb_entries
 * topic, no statute table row, no sentence an attorney already approved. A covered sentence is checked automatically by
 * that rule, so an attorney adds nothing; general wording ("you may have
 * rights", "every situation is different") is never a claim at all.
 *
 * This replaces the negative_statement and interpretation categories. They
 * sent a sentence to an attorney for HOW it was phrased ("not", "generally"),
 * which flagged correct general wording. Their sentences now pass through this
 * test like any other.
 */
import { statesLegalClaim } from "./legal-scope";

export { statesLegalClaim };
import { getThresholds, type KbThresholdEntry } from "./legal-knowledge-base";
import { thresholdCovers } from "./legal-value-check";
import { kbEntriesCover, loadLegalKb, type KbEntry } from "./legal-kb";
import { loadStatuteTable } from "./legal-statute-check";
import { compileTable, type StatuteRow } from "./legal-statute-table";
import { approvedKeys, loadLearned, sentenceKey } from "./legal-learned";

export type ClaimCoverage = {
  thresholds: KbThresholdEntry[];
  kbEntries: KbEntry[];
  statutes: StatuteRow[];
  /** Sentences an attorney approved before (lib/legal-learned.ts). */
  approved?: ReadonlySet<string>;
};

/** Is there a rule that already checks this sentence? */
export function ruleCovers(sentence: string, c: ClaimCoverage): boolean {
  if (c.approved?.has(sentenceKey(sentence))) return true;
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
  const [thresholds, kb, statutes, learned] = await Promise.all([
    getThresholds(tenantId).catch(() => [] as KbThresholdEntry[]),
    loadLegalKb(tenantId),
    loadStatuteTable(tenantId),
    loadLearned(tenantId),
  ]);
  return {
    thresholds,
    kbEntries: kb.ok ? kb.entries : [],
    statutes: statutes.ok ? statutes.rows : [],
    approved: approvedKeys(learned),
  };
}
