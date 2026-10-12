/**
 * Compliance check reads Brand settings (Oct 6 spec, Task 7).
 *
 *   node scripts/run.mjs scripts/check-compliance-task7.ts
 *
 * Pure, no model: applyFirmRules is everything after the model call. Covers
 * the done-when: no compliance output carries 646 849 3352, a never-in-content
 * number in a draft is a blocker, and "disclaimer missing" is never reported
 * when the last paragraph is the locked disclaimer.
 */
import { applyFirmRules } from "../lib/content-compliance";
import { closingCta, GENERAL_LEGAL_DISCLAIMER } from "../lib/legal-disclaimers";
import type { OperatingBrief } from "../lib/social-operating-brief";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const brief: OperatingBrief = {
  socialPhone: "646-466-6267",
  webPhone: "212-460-0047",
  documentPhone: "646-692-0511",
  offerPhrase: "Free Confidential Case Evaluation",
  offerPhraseEs: "Evaluación Gratuita y Confidencial de su Caso",
  hashtagRule: "4 to 5 relevant hashtags",
  disclaimerUrl: "/disclaimer/",
  neverInContentPhones: ["646-849-3352"],
  approvedPeople: ["Kenneth Katz"],
};

const blog = (extra = "") =>
  [
    "Attorney Advertising",
    "",
    "# Retaliation in New York",
    "",
    `Employees are protected from retaliation. ${extra}`,
    "",
    `**${closingCta(brief.webPhone, brief.offerPhrase)}**`,
    "",
    `*${GENERAL_LEGAL_DISCLAIMER}*`,
  ].join("\n");

const missingDisclaimer = {
  rule: "Legal advice disclaimer",
  severity: "medium" as const,
  excerpt: "",
  reason: "The page is missing a general information, not legal advice disclaimer.",
  fix: "Add a disclaimer at the end.",
};

// 1. A present locked disclaimer is never reported missing.
const r1 = applyFirmRules({
  raw: { score: 80, status: "needs_changes", violations: [missingDisclaimer], warnings: ["Add a not legal advice disclaimer."], requiredDisclaimers: [], summary: "ok" },
  content: blog(),
  surface: "blog",
  brief,
});
expect(!r1.violations.some((v) => /disclaimer/i.test(v.reason)), "present disclaimer not reported missing");
expect(r1.warnings.length === 0, `present disclaimer not warned (got ${JSON.stringify(r1.warnings)})`);

// 2. ...but a truly missing one still is.
const r2 = applyFirmRules({
  raw: { score: 80, status: "needs_changes", violations: [missingDisclaimer], warnings: [], requiredDisclaimers: [], summary: "" },
  content: blog().replace(`*${GENERAL_LEGAL_DISCLAIMER}*`, ""),
  surface: "blog",
  brief,
});
expect(r2.violations.some((v) => /disclaimer/i.test(v.reason)), "missing disclaimer still reported");

// 3. The model never hands the retired number back to Diana.
const r3 = applyFirmRules({
  raw: {
    score: 70,
    status: "needs_changes",
    violations: [{ rule: "CTA", severity: "low", excerpt: "", reason: "Weak CTA.", fix: "Call today at 646 849 3352 for a Free Confidential Case Evaluation." }],
    warnings: ["Use (646) 849-3352."],
    requiredDisclaimers: ["Call today at 646-849-3352 for a Free Confidential Case Evaluation."],
    summary: "Add the CTA with 646-849-3352.",
    suggestedRewrite: "Call today at 6468493352.",
  },
  content: blog(),
  surface: "blog",
  brief,
});
const out3 = JSON.stringify([r3.violations, r3.warnings, r3.requiredDisclaimers, r3.summary, r3.suggestedRewrite]);
expect(!/646\D{0,3}849\D{0,3}3352/.test(out3), `no output carries 646 849 3352 (got ${out3})`);
expect(out3.includes("212-460-0047"), "replaced with the website number");

// 4. The number in a draft is a blocker, on every surface.
for (const surface of ["blog", "social"] as const) {
  const r4 = applyFirmRules({
    raw: { score: 95, status: "compliant", violations: [], warnings: [], requiredDisclaimers: [], summary: "" },
    content: surface === "blog" ? blog("Call (646) 849-3352 now.") : "Questions? Call 646.849.3352 today.",
    surface,
    brief,
  });
  expect(r4.status === "non_compliant" && r4.violations.some((v) => v.severity === "high" && /never in content/.test(v.rule)),
    `${surface}: retired number blocks (got ${r4.status})`);
}

// 5. The prior-results disclaimer is a different thing and is never dropped.
const r5 = applyFirmRules({
  raw: {
    score: 70,
    status: "needs_changes",
    violations: [{ rule: "Case results", severity: "high", excerpt: "we recovered $2 million", reason: "Missing prior results disclaimer.", fix: "Add the prior results disclaimer." }],
    warnings: [],
    requiredDisclaimers: [],
    summary: "",
  },
  content: blog("We recovered $2 million for a client."),
  surface: "blog",
  brief,
});
expect(r5.violations.some((v) => /prior results/i.test(v.reason)), "prior-results note kept");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
