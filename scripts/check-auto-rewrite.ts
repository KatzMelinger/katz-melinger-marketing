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

const cta = { phone: "212-460-0047", offerPhrase: "Free Confidential Case Evaluation" };
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
  expect(r.body.includes("Call today at 212-460-0047 for a Free Confidential Case Evaluation."), "CTA inserted");
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

  // 4a. Attorney fee recovery is a remedy and stays (Kenneth, 2026-09-29).
  const remedy = await autoRewrite({
    body: "# Unpaid Wages\n\n## Can I recover attorney fees?\n\nYes. Attorneys' fees and costs are recoverable under the FLSA and NYLL, and the employer may have to pay your legal fees.",
    title: "Unpaid Wages",
    practiceArea: "employment",
    cta,
    noModel: true,
  });
  expect(
    remedy.body.includes("## Can I recover attorney fees?") && remedy.body.includes("Attorneys' fees and costs are recoverable"),
    "fee recovery remedy kept",
  );

  // 4b. Found by the library dry run: an EEOC "charge" FAQ is not a fee
  //     section; the office address keeps "NY 10017"; keyword lines keep "NY";
  //     a made-up short slug is pointed at the real page.
  const real = await autoRewrite({
    body: [
      "# Gender Discrimination",
      "",
      "**Target Keywords:** gender discrimination NY, NYC lawyer",
      "",
      "### Do I have to file a charge with an agency before I can sue?",
      "",
      "It depends on the law.",
      "",
      "See [retaliation](https://www.katzmelinger.com/retaliation/).",
      "",
      "370 Lexington Avenue, Suite 1512, New York, NY 10017",
    ].join("\n"),
    title: "Gender Discrimination",
    practiceArea: "employment",
    cta,
    noModel: true,
  });
  expect(real.body.includes("### Do I have to file a charge with an agency"), "EEOC charge FAQ kept");
  expect(real.body.includes("New York, NY 10017"), "postal address untouched");
  expect(real.body.includes("gender discrimination NY, NYC lawyer"), "keyword line untouched");
  expect(
    real.body.includes("https://katzmelinger.com/practice-areas/employment-law/retaliation/") &&
      !real.body.includes("katzmelinger.com/retaliation/)"),
    "short slug replaced with the real page",
  );

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

  // 6. Oct 6 spec: citations survive the state name rule (Task 6), hyphens
  //    go (trap 8) except in links, citations and statute numbers, and a
  //    third-person firm sentence is queued for a first-person rewrite (trap 7).
  const oct6 = await autoRewrite({
    body: [
      "# Severance in NY",
      "",
      "See N.Y.C. Admin. Code § 8-107 and *Murphy v. American Home Products Corp.*, 58 N.Y.2d 293 (1983), and N.J.S.A. 10:5-12.8.",
      "",
      "You are an at-will employee under N.Y. law. Your co-worker may sign a non-compete.",
      "",
      "Read [the guide](https://katzmelinger.com/practice-areas/employment-law/wage-hour-claims-employees/) and GOL § 5-336.",
      "",
      "The firm represents employees in New York.",
    ].join("\n"),
    title: "Severance",
    practiceArea: "employment",
    cta,
    statuteRows: STATUTE_TABLE,
    noModel: true,
  });
  expect(oct6.body.includes("N.Y.C. Admin. Code § 8-107"), "N.Y.C. citation untouched");
  expect(oct6.body.includes("58 N.Y.2d 293 (1983)"), "reporter citation untouched");
  expect(oct6.body.includes("N.J.S.A. 10:5-12.8"), "N.J.S.A. citation untouched");
  expect(oct6.body.includes("under New York law"), "N.Y. in prose still spelled out");
  expect(oct6.body.includes("an at will employee"), "hyphen removed");
  expect(oct6.body.includes("Your coworker may sign a non compete"), "closed form and non compete");
  expect(oct6.body.includes("wage-hour-claims-employees/"), "link target keeps its hyphens");
  expect(oct6.body.includes("§ 5-336"), "statute number keeps its hyphen");
  expect(oct6.attorneyReview.some((a) => /we.*our firm/i.test(a)), "third person queued for a rewrite");
  const oct6Again = await autoRewrite({ body: oct6.body, title: oct6.title, practiceArea: "employment", cta, statuteRows: STATUTE_TABLE, noModel: true });
  expect(oct6Again.changes.length === 0, "second run changes nothing");

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}
void main();
