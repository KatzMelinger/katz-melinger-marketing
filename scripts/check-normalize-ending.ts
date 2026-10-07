/**
 * Check the ending normalizer (Oct 6 spec, Task 2).
 *
 *   node scripts/run.mjs scripts/check-normalize-ending.ts
 *   node scripts/run.mjs scripts/check-normalize-ending.ts --snapshot drafts.json   # also every draft in a JSON dump
 *
 * Asserts, for every body: exactly one CTA, exactly one disclaimer, the label
 * on the first line, the locked disclaimer as the closing paragraph, and that
 * a second run changes nothing. The fixed cases are the shapes found in the
 * live library on 2026-10-06.
 */
import { readFileSync } from "node:fs";
import {
  closingCta,
  closingParagraph,
  countClosingCtas,
  countDisclaimers,
  firstLine,
  GENERAL_LEGAL_DISCLAIMER,
  normalizeEnding,
} from "../lib/legal-disclaimers";

const cta = { phone: "212-460-0047", offerPhrase: "Free Confidential Case Evaluation" };
const LOCKED = `*${GENERAL_LEGAL_DISCLAIMER}*`;
const CTA = `**${closingCta(cta.phone, cta.offerPhrase)}**`;

let failures = 0;
function check(name: string, body: string, extra?: (out: string) => string | null) {
  const a = normalizeEnding(body, { cta });
  const b = normalizeEnding(a.body, { cta });
  const problems: string[] = [];
  if (b.body !== a.body) problems.push("second run changed the body");
  if (b.changes.length) problems.push(`second run reported ${b.changes.length} changes`);
  if (countClosingCtas(a.body) !== 1) problems.push(`CTAs: ${countClosingCtas(a.body)}`);
  if (countDisclaimers(a.body) !== 1) problems.push(`disclaimers: ${countDisclaimers(a.body)}`);
  if (firstLine(a.body) !== "*Attorney Advertising*") problems.push(`first line: ${firstLine(a.body).slice(0, 40)}`);
  if (closingParagraph(a.body) !== LOCKED) problems.push(`closing: ${closingParagraph(a.body).slice(0, 60)}`);
  if (!a.body.includes(CTA)) problems.push("canonical CTA missing");
  const e = extra?.(a.body);
  if (e) problems.push(e);
  if (problems.length) {
    failures++;
    console.log(`FAIL ${name}: ${problems.join("; ")}`);
  }
  return a;
}

// The nested CTA (7a4bc5e3): the lead-in sentence on the same line stays.
check(
  "nested CTA keeps lead-in",
  "By Nicole Grunfeld, Katz Melinger PLLC*Attorney Advertising*\n\n# Title\n\nBody.\n\nKatz Melinger PLLC represents employees in New York and New Jersey. Call today at 212-460-0047 for a Call today at 212 460 0047 for a Call today at 212 460 0047 for a Free Case Evaluation...\n\n**This article is for general informational purposes only, is not legal advice, and does not create an attorney-client relationship. For more information, see our full [Disclaimer](https://katzmelinger.com/disclaimer/).**\n\n" + LOCKED,
  (out) =>
    !out.includes("Katz Melinger PLLC represents employees in New York and New Jersey.")
      ? "lead-in sentence was deleted"
      : !out.includes("By Nicole Grunfeld, Katz Melinger PLLC\n")
        ? "byline lost"
        : /Free Case Evaluation/.test(out)
          ? "old CTA survived"
          : null,
);
// Two CTAs and Diana's reworded disclaimer (56e75650).
check(
  "bold lead-in paragraph",
  "*Attorney Advertising*\n\n# T\n\nText.\n\n**Katz Melinger PLLC represents employees in New York and New Jersey who are not being paid correctly. Call today at 212 460 0047 for a Free Confidential Case Evaluation.**\n\n*This article is for general informational purposes only and is not legal advice. Reading it does not create an attorney client relationship. See our full [Disclaimer](https://katzmelinger.com/disclaimer/).*\n\n" + CTA + "\n\n" + LOCKED,
  (out) =>
    !out.includes("**Katz Melinger PLLC represents employees in New York and New Jersey who are not being paid correctly.**")
      ? "bold lead-in not kept intact"
      : null,
);
// Site footer pasted into the body (13338125).
check(
  "footer disclaimer in body",
  "# T\n\nText.\n\nAttorney Advertising. This website is designed for general informational purposes only. The information presented on this site should not be construed to be formal legal advice nor the formation of an attorney client relationship.\n\n" + CTA + "\n\n" + LOCKED,
);
// Old CTA line (43fb024e).
check("old CTA line", "# T\n\nText.\n\n**Call (212) 460-0047 for a free, confidential case review.**\n\n" + LOCKED);
// A body sentence that is not a CTA must survive.
check("body prose kept", "# T\n\nYou may call the agency today. The deadline is short.\n\nText.", (out) =>
  out.includes("You may call the agency today. The deadline is short.") ? null : "body prose deleted",
);
// Spanish is left alone.
{
  const es = "# Título\n\nTexto.";
  if (normalizeEnding(es, { cta, language: "es" }).body !== es) {
    failures++;
    console.log("FAIL Spanish body was changed");
  }
}

const snapIdx = process.argv.indexOf("--snapshot");
if (snapIdx > 0) {
  const drafts = JSON.parse(readFileSync(process.argv[snapIdx + 1], "utf8")) as {
    id: string;
    body: string | null;
    metadata?: { language?: string } | null;
  }[];
  let changed = 0;
  for (const d of drafts) {
    if (!d.body || d.metadata?.language === "es") continue;
    const before = d.body;
    const r = check(d.id.slice(0, 8), before);
    if (r.changes.length) changed++;
    // Nothing but the fixed elements may change: every line that disappeared
    // is a fixed-element line, and every new line is canonical or the
    // remainder of a line whose CTA or label was cut out.
    const fixed = /attorney advertising|call (us )?today at|informational purposes|legal advice|^\W*call\b.*\d{3}.\d{4}|prior results do not guarantee/i;
    const beforeLines = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
    const afterLines = new Set(r.body.split("\n").map((l) => l.trim()).filter(Boolean));
    const remainders = new Set(r.changes.map((c) => c.to.trim()).filter(Boolean));
    const lost = [...beforeLines].filter((l) => !afterLines.has(l) && !fixed.test(l));
    const gained = [...afterLines].filter((l) => !beforeLines.has(l) && !remainders.has(l));
    if (lost.length || gained.length) {
      failures++;
      console.log(`FAIL ${d.id.slice(0, 8)}: lost ${JSON.stringify(lost).slice(0, 200)} gained ${JSON.stringify(gained).slice(0, 200)}`);
    }
  }
  console.log(`snapshot: ${drafts.length} drafts, ${changed} would change`);
}

console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
