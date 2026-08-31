/**
 * New Jersey retrieval tests.
 *
 *   node scripts/run.mjs scripts/check-nj-retrieval.ts
 *
 * Two paths: the live wage-and-hour page, and the local corpus for everything
 * New Jersey does not publish machine-readably. Hits the network.
 *
 * The case that matters most is the LAST one: a citation with no source must
 * fail, not return something. New Jersey's failure mode is a page that answers
 * 200 and contains nothing relevant, which is how a claim gets marked checked
 * when nothing checked it.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

import { parseCitation, isRetrievable, formatCitation } from "@/lib/legal-citation";
import { extractNjSection, retrieveAuthority } from "@/lib/legal-retrieval";
import { validateEntry } from "@/lib/nj-statute-corpus";

let pass = 0, fail = 0;
const t = (n: string, c: boolean) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };

async function main() {
  console.log("Parsing New Jersey citations:");
  const lad = parseCitation("N.J.S.A. 10:5-12");
  t("N.J.S.A. 10:5-12 -> nj_statute 10 / 5-12",
    lad?.corpus === "nj_statute" && lad.book === "10" && lad.section === "5-12");
  const mw = parseCitation("N.J.S.A. 34:11-56a4");
  t("N.J.S.A. 34:11-56a4 -> nj_statute 34 / 11-56a4",
    mw?.corpus === "nj_statute" && mw.book === "34" && mw.section === "11-56a4");
  const njac = parseCitation("N.J.A.C. 12:56-6.1");
  t("N.J.A.C. 12:56-6.1 -> njac 12 / 56-6.1",
    njac?.corpus === "njac" && njac.book === "12" && njac.section === "56-6.1");
  t("spacing variants parse (NJSA 34:19-3)", parseCitation("NJSA 34:19-3")?.corpus === "nj_statute");
  t("NY citations still parse", parseCitation("NY Labor Law § 198-c")?.corpus === "ny_consolidated");
  t("CFR citations still parse", parseCitation("29 CFR 825.100")?.corpus === "cfr");

  console.log("\nOnly what the wage-and-hour page covers is addressable:");
  t("34:11-56a4 (wage and hour) IS retrievable", isRetrievable(mw!));
  t("12:56-6.1 (wage regs) IS retrievable", isRetrievable(njac!));
  t("10:5-12 (NJLAD) has no FETCH route — it is served from the corpus", !isRetrievable(lad!));
  t("34:19-3 (CEPA) is NOT", !isRetrievable(parseCitation("N.J.S.A. 34:19-3")!));

  console.log("\nSection extraction from the monolithic page:");
  const toc = "34:11-56a4. Minimum wage rate; exemptions 34:11-56a4.1. Summer camps 34:11-56a4.2. Application";
  const body = "34:11-56a4. Minimum wage rate; exceptions a. Except as provided in subsections c., d., e., " +
    "g., and i. of this section, each employer shall pay to each of his employees wages at a rate of not " +
    "less than $8.85 per hour as of January 1, 2019 and, on January 1 of 2020 and January 1 of each " +
    "subsequent year, the minimum wage shall be increased. 34:11-56a5. Administrative regulations";
  t("prefers the body over the table of contents",
    extractNjSection(toc + " " + body, "11-56a4").includes("each employer shall pay"));
  t("stops at the next section",
    !extractNjSection(toc + " " + body, "11-56a4").includes("Administrative regulations"));
  t("a section that is not there returns empty", extractNjSection(body, "19-3") === "");

  console.log("\nCorpus entries are validated, not trusted:");
  const good = {
    corpus: "nj_statute", book: "10", section: "5-12", heading: "Unlawful employment practices",
    text: "10:5-12. " + "It shall be an unlawful employment practice, or, as the case may be, an unlawful discrimination. ".repeat(4),
    source: "Westlaw", asOf: "2026-08-31", ingestedBy: "Kenneth Katz",
  };
  t("a complete entry validates", validateEntry(good).length === 0);
  t("missing provenance is refused",
    validateEntry({ ...good, source: "" }).some((p) => p.includes("source")));
  t("a heading pasted as the text is refused (too short)",
    validateEntry({ ...good, text: "Unlawful employment practices" }).some((p) => p.includes("too short")));
  t("the wrong section's text is refused",
    validateEntry({ ...good, section: "5-99" }).some((p) => p.includes("does not appear")));
  t("a bad asOf is refused",
    validateEntry({ ...good, asOf: "Aug 2026" }).some((p) => p.includes("yyyy-mm-dd")));

  console.log("\nLive retrieval:");
  const res = await retrieveAuthority(mw!, { tenantId: "00000000-0000-0000-0000-000000000001", skipCache: true });
  if (res.ok) {
    t(`fetched N.J.S.A. 34:11-56a4 (${res.value.text.length} chars)`, res.value.text.length > 400);
    t("  and it is the operative text, not a contents line",
      /each employer shall pay|minimum wage/i.test(res.value.text));
    console.log("      " + res.value.text.slice(0, 150).replace(/\s+/g, " "));
  } else {
    t("fetched N.J.S.A. 34:11-56a4 — " + res.failure.reason, false);
  }

  // NJLAD is now HELD LOCALLY, so it must resolve — from the corpus, not the
  // network. This assertion used to say the opposite; it was true until the
  // text was ingested, which is exactly the kind of stale test that keeps
  // passing after the world moves and quietly stops meaning anything.
  const ladRes = await retrieveAuthority(lad!, { tenantId: "00000000-0000-0000-0000-000000000001", skipCache: true });
  if (ladRes.ok) {
    t(`NJLAD 10:5-12 served from the corpus (${ladRes.value.text.length.toLocaleString()} chars)`, ladRes.value.text.length > 10_000);
    t("  and its provenance travels with it", /Westlaw|as of/i.test(ladRes.value.sourceUrl));
  } else {
    t("NJLAD 10:5-12 served from the corpus — " + ladRes.failure.reason, false);
  }

  // A New Jersey section with neither a fetch route nor a corpus entry must
  // still fail loudly. This is the guarantee that matters: no source means no
  // answer, never a confident one drawn from somewhere else.
  const absent = parseCitation("N.J.S.A. 10:5-29")!;
  const absentRes = await retrieveAuthority(absent, { tenantId: "00000000-0000-0000-0000-000000000001", skipCache: true });
  t("an un-ingested NJ section FAILS with a reason",
    !absentRes.ok && /no approved machine-readable source/i.test(absentRes.failure.reason));
  if (!absentRes.ok) console.log("      " + formatCitation(absent) + ": " + absentRes.failure.reason);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
