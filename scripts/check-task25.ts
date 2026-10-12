/**
 * Fewer, better flags (Oct 6 spec, Task 25).
 *
 *   node scripts/run.mjs scripts/check-task25.ts
 *
 * Pure, no DB, no model. Covers: one finding per sentence (the most severe
 * leads and lists the rest), style findings never stored, attorney routing
 * only for legal claims no rule covers, the retired categories, the shared
 * decision count and the 30-day History window.
 */
import { fingerprintFinding, type NormalizedFinding, type StoredFinding } from "../lib/content-findings";
import { mergeSameSentence, prepareFindings } from "../lib/finding-merge";
import { isDecision, withinHistory } from "../lib/finding-severity";
import { statesLegalClaim, type ClaimCoverage } from "../lib/legal-claim-routing";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";
import { toFinding, type ClaimVerdict } from "../lib/legal-verify";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const f = (
  source: NormalizedFinding["source"],
  ruleId: string,
  severity: NormalizedFinding["severity"],
  excerpt: string | null,
  title = ruleId,
): NormalizedFinding => ({
  fingerprint: fingerprintFinding(source, ruleId, excerpt ?? title),
  source,
  ruleId,
  severity,
  title,
  detail: null,
  excerpt,
  fix: null,
});

// 1. One sentence, one finding.
const S = "The NYCHRL applies to employers with four or more employees.";
const merged = mergeSameSentence([
  f("legal", "kb:R1:nychrl", "important", S, "Coverage threshold"),
  f("legal", "trap:abc", "critical", S, "NYCHRL covers one or more employees"),
  f("freshness", "outdated", "important", `${S} `, "Outdated figure"),
  f("legal", "trap:other", "important", "A different sentence about the NYSHRL deadline.", "Other"),
]);
expect(merged.length === 2, `same sentence merged into one (got ${merged.length})`);
const lead = merged.find((m) => m.excerpt === S);
expect(lead?.ruleId === "trap:abc" && lead.severity === "critical", `most severe leads (got ${lead?.ruleId})`);
expect(lead?.mergedFingerprints?.length === 2, "the other two are folded in");
expect(!!lead?.detail?.includes("Also raised by: Legal accuracy: Coverage threshold; Content freshness: Outdated figure"),
  `merged finding lists every rule (got ${lead?.detail})`);

// 2. Style findings are never stored; cannibalization is not style.
const prepared = prepareFindings([
  f("readability", "readability:02", "advisory", null, "Long paragraph"),
  f("brand_voice", "bv", "advisory", null, "Tone"),
  f("seo", "seo", "advisory", null, "No H2"),
  f("seo", "cannibalization", "important", null, "Competes with /blog/x"),
  f("compliance", "firm_fee", "critical", "We work on contingency, so you pay nothing unless we win.", "Fee"),
]);
expect(prepared.map((p) => p.ruleId).join(",") === "cannibalization,firm_fee", `style dropped (got ${prepared.map((p) => p.ruleId)})`);

// 3. What counts as a legal claim.
for (const s of [
  "Every situation is different, and you may have rights.",
  "An employment attorney can review your situation.",
  "Speak with an experienced employment lawyer about your options.",
]) expect(!statesLegalClaim(s), `general wording is not a claim: ${s}`);
for (const s of [
  "Employers with 15 or more employees must provide reasonable accommodations.",
  "Your employer cannot retaliate against you for filing a complaint.",
  "It is illegal to fire an employee for reporting wage theft.",
  "You must file within 300 days of the discriminatory act.",
]) expect(statesLegalClaim(s), `legal claim: ${s}`);

// 4. Routing: a claim no rule covers goes to an attorney; a covered one does not.
const claim = (sentence: string, claimType: ClaimVerdict["claim"]["claimType"]): ClaimVerdict => ({
  claim: { sentence, index: 0, claimType, jurisdiction: "NY", citations: [], reason: "", autoCheckable: false },
  verdict: "inconclusive",
  quote: null,
  reason: "not auto-checkable",
  sourceUrl: null,
});
const none: ClaimCoverage = { thresholds: [], kbEntries: [], statutes: [] };
const deadline: KbThresholdEntry = {
  key: "nyshrl_deadline", label: "NYSHRL deadline", practiceArea: "employment", jurisdiction: "NY", region: null,
  unit: "years", currentValue: 3, effectiveDate: "2024-02-15", priorValue: 1, priorEffectiveDate: null,
  scheduledValue: null, scheduledEffectiveDate: null,
  matchKeywords: ["NYSHRL|Division of Human Rights", "deadline|file|within"],
  enforcementPath: null, sourceUrl: null, notes: null,
};
const neg = "Under the NYSHRL, you cannot file a complaint more than 3 years after the act.";
const routed = toFinding(claim(neg, "negative_statement"), none);
expect(routed?.ruleId === "no_rule" && routed.claimType === "unclassified" && routed.title === "No rule for this claim yet",
  `uncovered negative statement goes to an attorney as no_rule (got ${routed?.ruleId}/${routed?.claimType})`);
expect(toFinding(claim(neg, "negative_statement"), { ...none, thresholds: [deadline] }) === null,
  "a claim the knowledge base covers is checked by the rule, not sent to an attorney");
expect(toFinding(claim("Every situation is different, and you may have rights under 29 U.S.C. 2601.", "interpretation"), none)?.ruleId === "no_rule",
  "general wording WITH a citation is still a claim");
expect(toFinding(claim("Every situation is different, and you may have rights.", "interpretation"), none) === null,
  "general wording without an anchor is never routed");
const contradicted = toFinding({ ...claim(neg, "negative_statement"), verdict: "contradicted", quote: "within three years" }, none);
expect(contradicted?.severity === "critical" && contradicted.claimType === "factual_mismatch",
  `a contradicted claim is critical and never a retired category (got ${contradicted?.claimType})`);

// 5. One decision count, shared by the panel and the report.
const stored = (over: Partial<StoredFinding>): StoredFinding => ({
  id: "x", draftId: "d", fingerprint: "p", source: "legal", ruleId: "no_rule", severity: "important",
  title: "t", detail: null, excerpt: null, fix: null, status: "open", resolution: null, resolvedByEmail: null,
  resolvedAt: null, resolutionNote: null, firstSeenAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-01T00:00:00Z",
  ...over,
} as StoredFinding);
expect(isDecision(stored({})), "an open legal claim is a decision");
expect(!isDecision(stored({ source: "readability", ruleId: "readability:02" })), "a style finding is not a decision");
expect(!isDecision(stored({ severity: "advisory", source: "compliance" })), "an advisory finding is not a decision");
expect(!isDecision(stored({ status: "resolved" })), "a closed finding is not a decision");

// 6. History: closed findings older than 30 days are not loaded.
const now = Date.parse("2026-10-12T12:00:00Z");
const hist = withinHistory(
  [
    stored({ id: "open-old", status: "open", lastSeenAt: "2026-01-01T00:00:00Z" }),
    stored({ id: "closed-new", status: "resolved", resolvedAt: "2026-10-01T00:00:00Z" }),
    stored({ id: "closed-old", status: "dismissed", resolvedAt: "2026-09-01T00:00:00Z" }),
  ],
  now,
);
expect(hist.map((h) => h.id).join(",") === "open-old,closed-new", `30-day window (got ${hist.map((h) => h.id)})`);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
