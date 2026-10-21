/**
 * The draft frame (Oct 20 spec, Task A1), checked on the errors Diana found.
 *
 *   node scripts/run.mjs scripts/check-draft-frame.ts
 *
 * Read-only, no DB. Every case is a body shape seen in a live draft: SEO notes
 * under the H1 (7be02d57), a byline glued to the first sentence, an old-format
 * CTA, two CTAs, a label glued to a heading, schema code, an author box. The
 * frame must come out in exactly the spec's order, once each, and assembling
 * twice must change nothing.
 */
import {
  assembleDraft,
  frameCtaLine,
  frameDisclaimerLine,
  frameLabelLine,
  reframeBody,
  splitDraft,
  type FrameBrand,
} from "../lib/draft-frame";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

const EN: FrameBrand = { language: "en", phone: "212-460-0047", offerPhrase: "Free Confidential Case Evaluation", offerPhraseEs: "Evaluación Gratuita y Confidencial de su Caso" };
const ES: FrameBrand = { ...EN, language: "es", spanishDisclaimerUrl: "https://katzmelinger.com/disclaimer/" };
const pending = { format: "blog", byline: { state: "pending" as const, attorney: "Adam Sackowitz" } };

const MESSY = `Attorney Advertising

# Collection Agency Attorney: What New York and New Jersey Businesses Need to Know

Target keywords: collection agency attorney, commercial debt collection lawyer New York, business debt attorney New Jersey
Meta description: How a collection agency attorney helps.

By Adam Sackowitz, Katz Melinger PLLCClients worked for four months before the invoice went unpaid.

**A collection agency attorney can sue, win a judgment and enforce it; an agency cannot.**

Most businesses try an agency first. Call today at (212) 460-0047 for a free case review.

## When to Hire a Lawyer

If the debtor ignores demand letters, it is time. See our [collections page](https://katzmelinger.com/commercial-collections/).

**Call today at 212-460-0047 for a Free Confidential Case Evaluation.**

## Frequently Asked Questions

### How long does a judgment last in New York?

Twenty years for a money judgment.

### Can I collect in New Jersey?

Yes, after domestication.

## About the Author

Adam Sackowitz is a partner.

\`\`\`json
{"@context":"https://schema.org","@type":"FAQPage"}
\`\`\`

*This article is for general informational purposes only, is not legal advice and does not create an attorney client relationship. For more information see our full [Disclaimer](https://katzmelinger.com/disclaimer/).*

*This article is for general informational purposes only and is not legal advice.*
`;

const split = splitDraft(MESSY);
const c = split.content;
check(c.h1.startsWith("Collection Agency Attorney"), "H1 found");
check(c.direct_answer.startsWith("A collection agency attorney can sue"), "bold first paragraph is the direct answer", c.direct_answer);
check(c.intro.includes("Clients worked for four months"), "a byline glued to the first sentence keeps the sentence", c.intro);
check(!/Call today|212/.test(c.intro), "a CTA inside the intro is removed, the rest of the paragraph stays", c.intro);
check(c.intro.includes("Most businesses try an agency first."), "prose around a removed CTA survives");
check(c.sections.length === 1 && c.sections[0].h2 === "When to Hire a Lawyer", "one section; FAQ and author box are not sections", JSON.stringify(c.sections.map((s) => s.h2)));
check(c.faq.length === 2 && c.faq[0].a.startsWith("Twenty years"), "FAQ parsed into questions and answers");
check(split.seoNotes.primaryKeyword?.startsWith("collection agency attorney") === true, "target keywords captured for metadata");
check(split.removed.some((r) => r.kind === "schema"), "schema code removed");
check(split.removed.some((r) => r.kind === "author_box"), "author box removed");

const body = assembleDraft(c, EN, pending);
const paras = body.trim().split(/\n\n+/);
check(paras[0] === frameLabelLine(EN), "label is the first line");
check(paras[1].startsWith("# Collection Agency Attorney"), "H1 second");
check(paras[2] === "*Pending attorney review: Adam Sackowitz*", "pending byline third", paras[2]);
check(paras[3].startsWith("**A collection agency attorney"), "direct answer fourth");
check(paras[paras.length - 1] === frameDisclaimerLine(EN), "disclaimer last");
check(paras[paras.length - 2] === frameCtaLine(EN), "CTA right before the disclaimer");
check(paras.filter((p) => p === frameCtaLine(EN)).length === 1, "exactly one CTA on a blog");
check(frameCtaLine(EN).includes("[212-460-0047](tel:+12124600047)"), "CTA number is a tel: link");
for (const note of ["Target keywords", "Primary keyword", "Meta title", "Meta description", "URL slug", "Search intent"]) {
  check(!body.includes(note), `no "${note}" in the body`);
}
check(!/\(212\) 460-0047|free case review/i.test(body), "old-format CTA gone");
check(!body.includes("About the Author") && !body.includes("@context"), "no author box, no schema in the body");
check((body.match(/general informational purposes/g) ?? []).length === 1, "one disclaimer");
const phones = body.split("\n").filter((l) => /212.?460.?0047/.test(l));
check(phones.length === 1 && phones[0] === frameCtaLine(EN), "no phone number outside the CTA line");

// Idempotent: reframing an assembled body changes nothing.
const again = reframeBody(body, EN, pending).body;
check(again === body, "assemble(split(assembled)) === assembled", again === body ? "" : diff(body, again));

// The reviewed byline after clearance.
const reviewed = assembleDraft(c, EN, {
  format: "blog",
  byline: { state: "reviewed", attorney: "Adam Sackowitz", bioUrl: "https://katzmelinger.com/attorney/adam-j-sackowitz/", clearedAt: "2026-10-21T15:00:00Z" },
});
check(
  reviewed.includes("Reviewed by [Adam Sackowitz](https://katzmelinger.com/attorney/adam-j-sackowitz/), Esq. | Last updated October 2026"),
  "reviewed byline, linked, with the month of clearance",
);
check(reframeBody(reviewed, EN, { format: "blog", byline: { state: "pending", attorney: "Adam Sackowitz" } }).body === body, "the reviewed byline is a frame line: reframing replaces it");

// A brand change reaches the draft through the frame.
const newPhone = assembleDraft(c, { ...EN, phone: "212-555-0100" }, pending);
check(newPhone.includes("212-555-0100") && !newPhone.includes("212-460-0047"), "changing the brand phone changes the CTA");

// Practice pages: up to three CTAs, all from the frame.
const practice = assembleDraft(
  { ...c, sections: [1, 2, 3, 4].map((n) => ({ h2: `Section ${n}`, body: `Text ${n}.`, kind: "standard" as const })) },
  EN,
  { format: "km_practice_page", byline: { state: "none" } },
);
check(practice.split(frameCtaLine(EN)).length - 1 === 3, "practice page: three CTAs");
check(reframeBody(practice, EN, { format: "km_practice_page", byline: { state: "none" } }).body === practice, "practice page reframes idempotently");

// Spanish frame (Kenneth, 2026-10-20).
const es = assembleDraft(c, ES, { format: "blog", byline: { state: "none" } });
check(es.startsWith("*Publicidad de abogados*"), "Spanish label");
check(es.includes("Llame hoy al [212-460-0047](tel:+12124600047) para una Evaluación Gratuita y Confidencial de su Caso."), "Spanish CTA");
check(es.includes("[Aviso Legal](https://katzmelinger.com/disclaimer/)"), "Spanish disclaimer links to the disclaimer page");
check(reframeBody(es, ES, { format: "blog", byline: { state: "none" } }).body === es, "Spanish page reframes idempotently");

// Prose that only looks like a byline stays.
const prose = splitDraft("# T\n\nBy filing a complaint, you start the clock.\n\nBy law, employers must pay overtime.\n");
check(prose.content.intro.includes("By filing a complaint") && prose.content.intro.includes("By law"), "sentences starting with \"By\" are prose");

// A result in the text brings the results line, before the CTA.
const result = assembleDraft({ ...c, intro: "We recovered $250,000 in a settlement for a client." }, EN, pending);
const rp = result.trim().split(/\n\n+/);
check(rp[rp.length - 3].startsWith("*Prior results do not guarantee"), "results line before the CTA when a result is described");

function diff(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) if (al[i] !== bl[i]) return `line ${i + 1}: ${JSON.stringify(al[i])} vs ${JSON.stringify(bl[i])}`;
  return "";
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
