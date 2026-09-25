/**
 * autoBreakLongParagraphs must break long prose paragraphs and touch nothing
 * else (Diana item 3, 21 September).
 *
 *   node scripts/run.mjs scripts/check-readability-autobreak.ts
 *
 * Pure, no DB, no network. This is the only readability fix applied without a
 * reviewer seeing a diff, so the cases that must come back BYTE-IDENTICAL are
 * the important half.
 */
import { autoBreakLongParagraphs, MAX_PARAGRAPH_SENTENCES } from "../lib/readability-rules";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${extra ? `  ${extra}` : ""}`);
};

const SIX = "One sentence here. Two sentences here. Three sentences here. Four sentences here. Five sentences here. Six sentences here.";

// --- must break -------------------------------------------------------------
const r1 = autoBreakLongParagraphs(SIX);
check("a six-sentence paragraph is broken", r1.broken === 1 && r1.body.includes("\n\n"));
check("no words are changed", r1.body.replace(/\s+/g, " ").trim() === SIX.replace(/\s+/g, " ").trim());
check(
  `each piece is <= ${MAX_PARAGRAPH_SENTENCES} sentences`,
  r1.body.split(/\n\s*\n/).every((p) => p.split(/(?<=[.!?])\s+/).filter(Boolean).length <= MAX_PARAGRAPH_SENTENCES),
);

// --- must be left byte-identical -------------------------------------------
const UNTOUCHED: Array<[string, string]> = [
  ["a four-sentence paragraph", "One. Two sentences here. Three sentences here. Four sentences here."],
  ["a heading", "## One. Two. Three. Four. Five. Six."],
  ["a bulleted list item", "- One. Two. Three. Four. Five. Six."],
  ["a numbered list item", "1. One. Two. Three. Four. Five. Six."],
  ["a blockquote", "> One. Two. Three. Four. Five. Six."],
  ["a table row", "| One. Two. | Three. Four. Five. Six. |"],
  ["an HTML block", "<p>One. Two. Three. Four. Five. Six.</p>"],
  ["fenced code", "```\nOne. Two. Three. Four. Five. Six.\n```"],
  ["empty input", ""],
];
for (const [name, input] of UNTOUCHED) {
  const out = autoBreakLongParagraphs(input);
  check(`untouched: ${name}`, out.body === input && out.broken === 0);
}

// --- a realistic document ---------------------------------------------------
const DOC = `# Unpaid Wages

${SIX}

## What the law says

- A list item that is long. It has several sentences. Still a list. Leave it alone. Really.

${SIX}

Short paragraph. Only two sentences.`;
const rd = autoBreakLongParagraphs(DOC);
check("document: both prose paragraphs broken", rd.broken === 2, `(broken=${rd.broken})`);
check("document: heading survives", rd.body.includes("# Unpaid Wages") && rd.body.includes("## What the law says"));
check("document: list item survives intact", rd.body.includes("- A list item that is long. It has several sentences. Still a list. Leave it alone. Really."));
check("document: short paragraph untouched", rd.body.includes("Short paragraph. Only two sentences."));
check(
  "document: no text lost",
  rd.body.replace(/\s+/g, " ").trim() === DOC.replace(/\s+/g, " ").trim(),
);

console.log(failed === 0 ? "\nall pass" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
