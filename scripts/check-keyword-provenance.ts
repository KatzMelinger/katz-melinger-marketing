/**
 * Data provenance on every SEO number (Oct 6 spec, Task 17).
 *
 *   node scripts/run.mjs scripts/check-keyword-provenance.ts
 *
 * No network: DataForSEO is unreachable here (no credentials loaded), which
 * is exactly the case where every number must come back marked an estimate.
 */
import { applyProvenance, suggestionProblem } from "../lib/keyword-provenance";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

// 1. Fee and firm-fact screening on suggestion text.
for (const s of [
  "Compare contingency vs. hourly arrangements for collections clients",
  "Explain how legal fees are handled",
  "Mention that you pay nothing unless we win",
  "Cover flat fee options for small businesses",
]) expect(suggestionProblem(s) !== null, `fee suggestion blocked: ${s}`);
for (const s of ["Write a step-by-step checklist for employees who were just fired", "FAQ on NY overtime rules for salaried staff"]) {
  expect(suggestionProblem(s) === null, `ordinary suggestion kept: ${s}`);
}

async function main() {
  // 2. A Discover result: estimates tagged, fee text removed, fee keyword dropped.
  const result = {
    keywords: [
      { keyword: "nyc overtime lawyer", volume: 195, difficulty: 40, contentSuggestion: "Guide to NY overtime rules" },
      { keyword: "collections attorney fees", volume: 220, difficulty: 30, contentSuggestion: "Contingency vs. hourly arrangements" },
      { keyword: "contingency fee lawyer", volume: 290, difficulty: 50, contentSuggestion: "Explain contingency fees" },
    ],
    quickWins: [{ keyword: "nyc overtime lawyer", volume: 160, difficulty: 20, reason: "Low competition" }],
    contentGaps: [{ topic: "No upfront cost representation", suggestedKeywords: ["no fee unless we win lawyer", "wage theft nyc"] }],
    summary: "Focus on overtime.",
  };
  const out = (await applyProvenance(result)) as typeof result & { provenance: { estimates: number; removedSuggestions: number } };
  const kws = out.keywords as Array<Record<string, unknown>>;
  expect(!kws.some((k) => k.keyword === "contingency fee lawyer"), "a fee keyword is dropped");
  expect(kws.every((k) => k.volumeSource === "ai_estimate" && k.difficultySource === "ai_estimate"), "unconfirmed numbers are marked estimates");
  const fees = kws.find((k) => k.keyword === "collections attorney fees");
  expect(!!fees && fees.contentSuggestion === "" && typeof fees.contentSuggestionRemoved === "string", "fee suggestion text removed with a reason");
  expect(out.contentGaps[0].topic === "", "fee topic removed");
  expect(!out.contentGaps[0].suggestedKeywords.includes("no fee unless we win lawyer"), "fee keyword removed from a gap list");
  expect(out.contentGaps[0].suggestedKeywords.includes("wage theft nyc"), "ordinary gap keyword kept");
  expect(out.provenance.estimates >= 3 && out.provenance.removedSuggestions >= 3, `provenance summary (${JSON.stringify(out.provenance)})`);
  const json = JSON.stringify(out).toLowerCase();
  expect(!/contingency|hourly|flat fee|no fee unless/.test(json.replace(/"[a-z]+removed":"[^"]*"/g, "")), "no suggestion mentions contingency, hourly or flat fees");

  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
