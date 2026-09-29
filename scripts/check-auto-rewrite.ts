/**
 * The section 9 rewrite and its change log, without a model call.
 *
 *   node scripts/run.mjs scripts/check-auto-rewrite.ts
 *
 * Read-only, no DB. Covers what the spec's done-when names for the gender
 * draft (constant fixed, author fixed, each change logged with a source, one
 * change undone restores only that sentence) plus the rules that must never
 * rewrite: a debtor-side draft stops at "Full redraft needed", fee sentences
 * are deleted and not replaced, and nothing inside a URL or heading moves.
 */
import { autoRewrite } from "../lib/auto-rewrite";
import { undoChange } from "../lib/legal-fix-log";
import { STATUTE_TABLE } from "../lib/legal-statute-table";
import type { NormalizedFinding } from "../lib/content-findings";

const cta = { phone: "646-849-3352", offerPhrase: "Free Confidential Case Evaluation" };
let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

async function main() {
  // 1. Gender draft shape.
  const oneYear = "You must file a complaint with the NYSHRL within one year of the discrimination.";
  const gender = [
    "# Is Gender a Protected Class in NY?",
    "",
    "By Daniel Melinger, Esq.",
    "",
    "Gender is a protected class under federal, New York state, and New York City law.",
    "",
    oneYear,
    "",
    "## How We Can Help",
    "",
    "We work on a contingency basis, so you pay nothing unless we win. Our team reviews every case — carefully.",
    "",
    "Read more at [our page](https://katzmelinger.com/practice-areas/employment-law/discrimination/) about NY law. #EmploymentLaw",
  ].join("\n");
  const kb: NormalizedFinding[] = [
    {
      fingerprint: "x",
      source: "legal",
      ruleId: "constant_mismatch",
      severity: "critical",
      title: "NYSHRL administrative complaint deadline is 3 years, not 1 year",
      detail: null,
      excerpt: oneYear,
      fix: 'Replace "one year" with "3 years". Change nothing else in the sentence.',
    },
  ];
  const r = await autoRewrite({
    body: gender,
    title: "Is Gender a Protected Class in NY?",
    practiceArea: "employment",
    cta,
    kbFindings: kb,
    statuteRows: STATUTE_TABLE,
    noModel: true,
  });
  expect(r.fullRedraft === null, "gender draft is patchable");
  expect(r.body.includes("within 3 years"), "one year -> 3 years");
  expect(r.body.includes("By Nicole Grunfeld, Katz Melinger PLLC"), "author -> Nicole Grunfeld");
  expect(!/contingency|pay nothing unless/i.test(r.body), "fee sentence deleted");
  expect(!r.body.includes("—"), "em dash removed");
  expect(!/#EmploymentLaw/.test(r.body), "hashtag removed");
  expect(r.body.includes("about New York law"), "NY spelled out in body text");
  expect(r.body.startsWith("*Attorney Advertising*"), "label inserted");
  expect(r.body.includes("Call today at 646-849-3352 for a Free Confidential Case Evaluation."), "CTA inserted");
  expect(r.body.includes("general informational purposes only"), "disclaimer inserted");
  expect(r.body.includes("## Related Resources"), "internal links topped up");
  expect(r.body.includes("# Is Gender a Protected Class in NY?"), "H1 keyword left alone");
  expect(r.body.includes("https://katzmelinger.com/practice-areas/employment-law/discrimination/"), "URL untouched");
  for (const c of r.changes) expect(!!c.source && !!c.reason && !!c.at && !!c.id, `change has source/reason/date: ${c.reason}`);

  // Undo only the knowledge-base change.
  const kbChange = r.changes.find((c) => c.source === "knowledge base");
  expect(!!kbChange, "knowledge base change logged");
  if (kbChange) {
    const u = undoChange(r.body, r.title, kbChange);
    expect(u.ok && u.body.includes("within one year"), "undo restores one year");
    expect(u.ok && u.body.includes("By Nicole Grunfeld"), "undo leaves the author change");
  }
  // Undo a deletion (the fee sentence) puts it back.
  const feeChange = r.changes.find((c) => c.source_ref === "fee_language");
  if (feeChange) {
    const u = undoChange(r.body, r.title, feeChange);
    expect(u.ok && /contingency/.test(u.body), "undo puts a deleted sentence back");
  } else expect(false, "fee deletion logged");

  // 2. Second run changes nothing (idempotent).
  const again = await autoRewrite({ body: r.body, title: r.title, practiceArea: "employment", cta, statuteRows: STATUTE_TABLE, noModel: true });
  expect(again.changes.length === 0, `second run is a no-op (got ${again.changes.map((c) => c.reason).join(" | ")})`);

  // 3. Debtor-side collections draft: stop, never patch.
  const debtor = await autoRewrite({
    body: "# What Debtors Need to Know\n\nIf you owe money, a law office debt collector contacts you. You can dispute the debt.",
    title: "Law Office Debt Collector: What Debtors Need to Know",
    practiceArea: "collections",
    cta,
    noModel: true,
  });
  expect(!!debtor.fullRedraft && debtor.changes.length === 0, "debtor draft flagged Full redraft needed, unchanged");

  // 4. FAQ entry about fees is removed whole.
  const faq = await autoRewrite({
    body: "# Unpaid Overtime Lawyer\n\n## How do you charge for wage and hour cases?\n\nMost firms work on contingency.\n\n## What should I bring?\n\nPay stubs.",
    title: "Unpaid Overtime Lawyer",
    practiceArea: "employment",
    cta,
    noModel: true,
  });
  expect(!/How do you charge/.test(faq.body) && faq.body.includes("## What should I bring?"), "fee FAQ removed, next section kept");

  // 5. Statute mismatch without a model is routed, not silently passed.
  const st = await autoRewrite({
    body: "# Tips\n\nSection 196 d, which governs tip credit rules, protects workers under the Labor Law.",
    title: "Tip rules",
    practiceArea: "employment",
    cta,
    statuteRows: STATUTE_TABLE,
    noModel: true,
  });
  expect(st.attorneyReview.some((a) => /196/.test(a)), "statute mismatch routed when no model");

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}
void main();
