/**
 * Add a New Jersey statute or regulation section to the local corpus.
 *
 *   node scripts/run.mjs scripts/ingest-nj-statute.ts --list
 *   node scripts/run.mjs scripts/ingest-nj-statute.ts \
 *        --citation "N.J.S.A. 10:5-12" \
 *        --heading "Unlawful employment practices" \
 *        --source "Westlaw, N.J.S.A. 10:5-12 (current through L.2026, c.41)" \
 *        --as-of 2026-08-31 \
 *        --by "Kenneth Katz" \
 *        --file ./10-5-12.txt
 *
 * NJLAD and CEPA cannot be fetched — every New Jersey route was tested and
 * rejected (see lib/nj-statute-corpus.ts). This is how their text gets in:
 * pasted from a source the firm lawfully has, with provenance recorded.
 *
 * --file, never inline text. Statutory text is thousands of characters and
 * shells mangle long arguments; a file is also what someone exported from
 * Westlaw or Lexis in the first place.
 *
 * The text is stored VERBATIM. lib/legal-verify.ts requires a quote to appear
 * in it character for character, so a tidied or summarised paste does not
 * merely weaken the check — it makes true claims fail, and the natural response
 * to that is to loosen the guard, which is how the one control against
 * fabricated contradictions gets removed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { parseCitation } from "@/lib/legal-citation";
import {
  CORPUS_DIR,
  entryFilename,
  validateEntry,
  corpusSummary,
  clearCorpusCache,
  type CorpusEntry,
} from "@/lib/nj-statute-corpus";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function main() {
  if (process.argv.includes("--list")) {
    const held = corpusSummary();
    if (!held.length) {
      console.log("The New Jersey corpus is empty.\n");
      console.log("Nothing is fabricated into it: until a section is ingested,");
      console.log("citations to it route to an attorney, which is the behaviour today.");
      return;
    }
    console.log(`${held.length} section(s) held:\n`);
    for (const h of held) console.log(`  ${h.citation.padEnd(22)} ${h.heading}  (as of ${h.asOf})`);
    return;
  }

  const citationArg = arg("citation");
  const heading = arg("heading");
  const source = arg("source");
  const asOf = arg("as-of");
  const by = arg("by");
  const file = arg("file");

  const missing = [
    ["--citation", citationArg], ["--heading", heading], ["--source", source],
    ["--as-of", asOf], ["--by", by], ["--file", file],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    console.error("Run with --list to see what is already held.");
    process.exit(1);
  }

  const parsed = parseCitation(citationArg!);
  if (!parsed || (parsed.corpus !== "nj_statute" && parsed.corpus !== "njac")) {
    console.error(
      `"${citationArg}" did not parse as a New Jersey citation.\n` +
        `Expected something like "N.J.S.A. 10:5-12" or "N.J.A.C. 12:56-6.1".`,
    );
    process.exit(1);
  }

  if (!existsSync(file!)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }
  const text = readFileSync(file!, "utf8").replace(/\r\n/g, "\n").trim();

  const entry: CorpusEntry = {
    corpus: parsed.corpus,
    book: parsed.book,
    section: parsed.section,
    heading: heading!,
    text,
    source: source!,
    asOf: asOf!,
    ingestedBy: by!,
  };

  const problems = validateEntry(entry);
  if (problems.length) {
    console.error("Refusing to store this entry:\n");
    for (const p of problems) console.error("  - " + p);
    console.error(
      "\nAn entry becomes the ground truth a claim is judged against. One missing\n" +
        "its provenance, or holding the wrong section's text, is worse than no entry:\n" +
        "it looks checked.",
    );
    process.exit(1);
  }

  mkdirSync(CORPUS_DIR, { recursive: true });
  const path = join(CORPUS_DIR, entryFilename(parsed.corpus, parsed.book, parsed.section));
  const existed = existsSync(path);
  writeFileSync(path, JSON.stringify(entry, null, 2) + "\n", "utf8");
  clearCorpusCache();

  console.log(`${existed ? "Replaced" : "Stored"} ${citationArg} — ${heading}`);
  console.log(`  ${text.length.toLocaleString()} characters, as of ${asOf}`);
  console.log(`  ${path}`);
  console.log(`  source: ${source}`);
}

main();
