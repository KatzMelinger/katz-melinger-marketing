/**
 * Check locateSentence (lib/legal-sentence-fix.ts): Apply fix must replace
 * exactly the sentence a legal flag quotes, whatever shape the excerpt has.
 *
 *   node scripts/run.mjs scripts/check-legal-sentence-fix.ts
 */
import { locateSentence, rawSentences } from "../lib/legal-sentence-fix";

const body = [
  "# Title",
  "",
  "In New York, the New York State Human Rights Law (NYSHRL) applies to employers with four or more employees, and the [New York City Human Rights Law](https://www.nyc.gov/site/cchr/) applies to employers with four or more employees. See *Murphy v. American Home Products Corp.*, 58 N.Y.2d 293 (1983).",
  "",
  "Request your personnel file from your employer. New York and New Jersey law give employees the right to inspect and copy their personnel files upon request. Your file may contain evaluations.",
].join("\n");

let failed = 0;
const expect = (name: string, excerpt: string, startsWith: string | null) => {
  const s = locateSentence(body, excerpt);
  const ok = startsWith === null ? s === null : !!s && s.text.startsWith(startsWith) && body.slice(s.start, s.start + s.text.length) === s.text;
  if (!ok) {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(s?.text?.slice(0, 80) ?? null)}`);
  }
};

// Sentence-mode excerpt (links stripped by the matcher).
expect(
  "stripped sentence",
  "In New York, the New York State Human Rights Law (NYSHRL) applies to employers with four or more employees, and the New York City Human Rights Law applies to employers with four or more employees.",
  "In New York, the New York State",
);
// Older "…60 characters either side…" excerpt spanning two sentences: the middle picks the right one.
expect(
  "context excerpt",
  "…tion cases. Request your personnel file from your employer. New York and New Jersey law give employees the right to inspect and copy their personnel …",
  "New York and New Jersey law give",
);
// A case citation's periods do not split the sentence.
expect("citation sentence", "See Murphy v. American Home Products Corp., 58 N.Y.2d 293 (1983).", "See *Murphy v.");
// Text that is not there.
expect("absent", "The NYSHRL applies to all employers regardless of size.", null);

const n = rawSentences(body).length;
if (n !== 6) {
  failed++;
  console.log(`FAIL sentence count: ${n}, want 6`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
