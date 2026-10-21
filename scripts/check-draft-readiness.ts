/**
 * The Ready checklist (Oct 20 spec, Task A4) and the Reviewed by byline
 * (Task A2), checked on fixtures.
 *
 *   node scripts/run.mjs scripts/check-draft-readiness.ts
 *
 * Read-only, no DB. A draft passes only when every item passes; each failure
 * names its reason. Includes Diana's Task A6 case: the old "By Nicole
 * Grunfeld, Katz Melinger PLLC" byline on a draft must not be Ready.
 */
import { assembleDraft, splitDraft, type DraftContent } from "../lib/draft-frame";
import { bylineForDraft, frameBrandFrom, reviewAreaForDraft, type DraftForFrame } from "../lib/draft-frame-server";
import { isReady, type ReadinessFinding } from "../lib/draft-readiness";
import type { OperatingBrief } from "../lib/social-operating-brief";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

const brief: OperatingBrief = {
  socialPhone: "646-466-6267",
  webPhone: "212-460-0047",
  documentPhone: "646-692-0511",
  offerPhrase: "Free Confidential Case Evaluation",
  offerPhraseEs: "Evaluación Gratuita y Confidencial de su Caso",
  hashtagRule: "",
  disclaimerUrl: "/disclaimer/",
  neverInContentPhones: ["646-849-3352"],
  approvedPeople: [],
  spanishDisclaimerUrl: "https://katzmelinger.com/disclaimer/",
  reviewersByPractice: {
    employment: { name: "Nicole Grunfeld", bio_url: "https://katzmelinger.com/attorney/nicole-d-grunfeld/" },
    commercial_collections: { name: "Adam Sackowitz", bio_url: "https://katzmelinger.com/attorney/adam-j-sackowitz/" },
    judgment_enforcement: { name: "Kenneth Katz", bio_url: "https://katzmelinger.com/attorney/kenneth-j-katz/" },
  },
};

const content: DraftContent = {
  version: 1,
  h1: "Collection Agency Law Firm: What New York and New Jersey Businesses Need to Know",
  direct_answer: "A collection agency law firm can sue a debtor, win a judgment and enforce it.",
  intro: "We represent creditors.",
  sections: [
    {
      h2: "When to Hire a Lawyer",
      body:
        "See our [collections page](https://katzmelinger.com/commercial-collections/), " +
        "[judgment enforcement](https://katzmelinger.com/judgment-enforcement/) and " +
        "[business debt](https://katzmelinger.com/business-debt-collection/).",
      kind: "standard",
    },
  ],
  faq: [{ q: "How long does a judgment last in New York?", a: "Twenty years for a money judgment." }],
  case_result: { present: false, text: "" },
};

const baseMeta = {
  content,
  primaryKeyword: "collection agency law firm",
  keyword_selection: { status: "selected", chosen: { keyword: "collection agency law firm", volume: 210 } },
};
const draft = (meta: Record<string, unknown>, body?: string): DraftForFrame & { id: string } => {
  const d: DraftForFrame & { id: string } = {
    id: "48d5e3f7",
    title: content.h1,
    topic: "collection agency law firm",
    format: "blog",
    practice_area: "Commercial Collections",
    metadata: meta,
    body: "",
  };
  d.body = body ?? assembleDraft(content, frameBrandFrom(brief, "en"), { format: "blog", byline: bylineForDraft(d, brief) });
  return d;
};
const none: ReadinessFinding[] = [];

// Practice area -> reviewing attorney (Task A2).
check(reviewAreaForDraft(draft(baseMeta)) === "commercial_collections", "collections draft -> commercial collections");
check(
  reviewAreaForDraft({ title: "How to Enforce a Judgment in New York", topic: null, practice_area: "Commercial Collections", metadata: {} }) === "judgment_enforcement",
  "judgment enforcement title -> judgment enforcement",
);
check(reviewAreaForDraft({ title: "A note", topic: null, practice_area: null, metadata: {} }) === null, "nothing to go on -> unknown, not a default attorney");

// 48d5e3f7 before clearance: Pending attorney review: Adam Sackowitz.
const pending = draft(baseMeta);
check(pending.body.includes("*Pending attorney review: Adam Sackowitz*"), "48d5e3f7 shows Pending attorney review: Adam Sackowitz");
const r1 = isReady(pending, brief, none);
check(!r1.ready && r1.failing.join() === "clearance", "only the clearance is missing before the attorney clears it", r1.failing.join());
check(r1.items.find((i) => i.key === "clearance")!.reasons[0].includes("Adam Sackowitz"), "the clearance item names the attorney");

// After clearance: Reviewed by, linked, Last updated; Ready.
const reviewMeta = {
  ...baseMeta,
  review: { attorney: "Adam Sackowitz", bio_url: "https://katzmelinger.com/attorney/adam-j-sackowitz/", area: "commercial_collections", cleared_at: "2026-10-21T15:00:00Z", cleared_by_user: "asackowitz@katzmelinger.com" },
};
const cleared = draft(reviewMeta);
check(
  cleared.body.includes("Reviewed by [Adam Sackowitz](https://katzmelinger.com/attorney/adam-j-sackowitz/), Esq. | Last updated October 2026"),
  "after clearance: Reviewed by [Adam Sackowitz](bio), Esq. | Last updated October 2026",
);
const r2 = isReady(cleared, brief, none);
check(r2.ready, "cleared draft with a selected keyword and three links is Ready", r2.failing.join());

// Task A6 case: the old byline on an otherwise ready draft is not Ready.
const oldByline = cleared.body.replace(/^Reviewed by .*$/m, "By Nicole Grunfeld, Katz Melinger PLLC");
const r3 = isReady({ ...cleared, body: oldByline }, brief, none);
check(!r3.ready && r3.failing.includes("frame"), 'A6: "By Nicole Grunfeld, Katz Melinger PLLC" on a draft -> not Ready (frame)');

// "Reviewed by" never without a clearance record: a body claiming it fails the frame.
const forged = isReady({ ...pending, body: cleared.body }, brief, none);
check(!forged.ready && forged.failing.includes("frame"), "a Reviewed by line without metadata.review fails");

// Each item fails for its own reason.
const fee = draft(reviewMeta);
const feeBody = fee.body.replace("We represent creditors.", "We represent creditors. Many employment attorneys offer free initial consultations.");
check(isReady({ ...fee, body: feeBody }, brief, none).failing.includes("fee"), "fee language fails the fee rule");
check(isReady(draft({ ...reviewMeta, primaryKeyword: "publish 'what to do after being fired' action checklist for retaliation cases" }), brief, none).failing.includes("keyword"), "a task title as keyword fails");
check(isReady(draft({ ...reviewMeta, keyword_selection: undefined }), brief, none).failing.includes("keyword"), "a keyword not chosen with volume fails");
check(isReady(cleared, brief, [{ severity: "critical", source: "legal", ruleId: "trap:1", title: "Trap 1", excerpt: "x" }]).failing.includes("checks"), "an open critical finding fails");
const decision = isReady(cleared, brief, [{ severity: "important", source: "legal", ruleId: "no_rule", title: "No rule", excerpt: "New Jersey employees have 300 days to file a CEPA claim." }]);
check(decision.failing.includes("legal_facts") && decision.items.find((i) => i.key === "legal_facts")!.reasons[0].includes("Adam Sackowitz"), "a claim with no knowledge base entry is a decision naming the attorney");
check(isReady(cleared, brief, [{ severity: "advisory", source: "legal", ruleId: "no_rule_confirm", title: "x", excerpt: "y" }]).ready, "a Please confirm item does not block");
check(isReady({ ...cleared, body: cleared.body.replace("We represent creditors.", "We represent creditors — always.") }, brief, none).failing.includes("style"), "an em dash fails style");
const noLinks = { ...content, sections: [{ h2: "When", body: "No links here.", kind: "standard" as const }] };
const nl = draft({ ...reviewMeta, content: noLinks });
check(isReady(nl, brief, none).failing.includes("links"), "fewer than three internal links fails");
check(isReady({ ...cleared, metadata: { ...reviewMeta, content: undefined } }, brief, none).failing.includes("frame"), "a draft not yet in the frame fails with Rescan advice");

// Unknown practice area cannot reach Ready.
const unknown = draft({ ...reviewMeta, review: undefined });
const u = isReady({ ...unknown, practice_area: null, title: "A note", topic: null, body: assembleDraft(content, frameBrandFrom(brief, "en"), { format: "blog", byline: { state: "pending", attorney: null } }) }, brief, none);
check(!u.ready && u.items.find((i) => i.key === "clearance")!.reasons[0].includes("practice area is not set"), "unknown practice area cannot reach Ready");

// Item 9 is shown, never blocking, until Part 4.
check(r2.items.some((i) => i.key === "sources_quality" && i.pending && i.pass), "item 9 (sources, SEO/AEO) shown as not active yet");

// Rebuild path: a messy old body split and assembled is in the frame.
const rebuilt = splitDraft(oldByline);
check(rebuilt.content.h1 === content.h1, "split keeps the H1");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
