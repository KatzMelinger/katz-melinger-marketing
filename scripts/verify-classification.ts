/**
 * Read-only smoke test for Diana's 2026-06-15 keyword-classification decisions.
 * Runs her exact example keywords through the real classifier functions and
 * prints what each one resolves to. Writes nothing.
 *
 *   npx tsx scripts/verify-classification.ts
 */
import { scoreKeyword, KM_BRAND_TOKENS } from "@/lib/keyword-filter";
import { inferPracticeArea, inferPillar } from "@/lib/strategy-engine";
import { getPillarById } from "@/lib/km-content-system";

const ctx = { brandTokens: KM_BRAND_TOKENS, competitorTokens: [] as string[] };

function show(label: string, keywords: string[]) {
  console.log(`\n=== ${label} ===`);
  for (const kw of keywords) {
    const q = scoreKeyword(kw, {}, ctx);
    if (q.excluded) {
      console.log(`  DROP   "${kw}"  → ${q.excludeReason}`);
      continue;
    }
    const area = inferPracticeArea({ clusterName: kw, primaryKeyword: kw });
    const pid = inferPillar({ clusterName: kw, primaryKeyword: kw }, area);
    const pillar = pid ? getPillarById(pid) : undefined;
    const dest = pid ? `${pid} (${pillar?.url ?? "?"})` : "NEEDS REVIEW";
    console.log(`  KEEP   "${kw}"  → ${area} / ${dest}`);
  }
}

// 2a — general high-intent → employment hub
show("2a general commercial (→ employment-hub /employment-law/)", [
  "employment lawyer nyc",
  "best employment lawyer nyc",
  "nyc employment lawyer free consultation",
]);

// 2a — collections (→ collections, /civil-litigation/collections-judgment-enforcement/)
show("2a collections (→ collections)", [
  "information subpoena",
  "notice of pendency",
  "debt lawyer nyc",
  "judgement recovery",
]);

// 2a — workers comp → DROP
show("2a workers comp (→ DROP)", [
  "workers comp lawyer nyc",
  "workers compensation claim",
  "injured at work",
  "workplace injury attorney",
]);

// 2a — drug testing by angle, else needs review
show("2a drug testing (→ by angle)", [
  "fired after failing drug test",          // → wrongful-termination
  "employer only drug tests certain employees", // → hostile
  "drug test discrimination disability",    // → discrimination
  "drug test accommodation request denied", // → leave
  "workplace drug testing laws ny",         // → needs review
]);

// 2b — unemployment → DROP all six
show("2b unemployment (→ DROP)", [
  "unemployment attorney nyc",
  "brooklyn unemployment",
  "can collect unemployment if you quit",
  "i quit can i get unemployment",
  "independent contractor unemployment",
  "new york state unemployment eligibility",
]);

// 2c — three reverts
show("2c reverts", [
  "does termination void a non compete",    // → severance
  "non compete after termination",          // → severance
  "part time sick leave",                   // → leave
]);
