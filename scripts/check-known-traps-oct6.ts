/**
 * Test the Oct 6 traps (lib/known-traps-oct6.ts) against the real matcher.
 *
 *   node scripts/run.mjs scripts/check-known-traps-oct6.ts
 *   node scripts/run.mjs scripts/check-known-traps-oct6.ts --snapshot drafts.json
 *
 * Fixed cases: sentences each trap must catch and sentences it must leave
 * alone (including Kenneth's locked disclaimer and the corrected texts from
 * the spec, which must pass every trap). With --snapshot, also scan a JSON
 * dump of the open website drafts and compare with the drafts the spec says
 * each trap matched on 2026-10-02 (Task 14).
 */
import { readFileSync } from "node:fs";
import { matchTrap, type KnownTrap, type TrapContext } from "../lib/known-traps";
import { OCT6_TRAPS } from "../lib/known-traps-oct6";
import { GENERAL_LEGAL_DISCLAIMER } from "../lib/legal-disclaimers";

const traps: Record<string, KnownTrap> = Object.fromEntries(
  OCT6_TRAPS.map((t) => [t.number, { ...t, id: t.number, enabled: true }]),
);

const harass: TrapContext = { title: "Sexual harassment in New York", isWebPage: true };

const FIRE: [string, string, TrapContext?][] = [
  ["1", "New York and New Jersey courts recognize a public policy exception to at will employment."],
  ["2", "See Sabetay v. Sterling Drug, Inc., 69 N.Y.2d 329 (1987), recognizing the doctrine."],
  ["3", "The violation must create a substantial danger to public health or safety."],
  ["4", "Your employer can change your pay without notice."],
  ["5", "*This article is for general informational purposes only and is not legal advice. Reading it does not create an attorney client relationship.*"],
  ["6", "Call today at 212-460-0047 for a Call today at 212 460 0047 for a Free Case Evaluation."],
  ["7", "Katz Melinger PLLC represents employees in New York."],
  ["8", "You are an at-will employee."],
  ["9", "The New York City Human Rights Law applies to employers with four or more employees.", harass],
  ["10", "To file with the New York City Commission on Human Rights, the deadline is 1 year.", harass],
  ["11", "Settlement agreements typically include confidentiality provisions and a release."],
  ["12", "New York does not require a review period if the employee is under 40."],
  ["13", "Any attempt to pressure you makes the release unenforceable."],
  ["14", "The release covers Title VII, the ADEA and the Fair Labor Standards Act."],
  ["15", "New York requires real consideration, meaning you must receive something new at signing."],
  ["15", "A non compete signed mid job needs new consideration."],
  ["16", "The FTC issued a rule banning most non-competes, but courts blocked it."],
  ["17", "The bank freezes the debtor's account up to the amount of the judgment."],
  ["18", "The Special Civil Part hears claims of $15,000 or less."],
  ["19", "the jurisdictional minimum, typically 6 years in New York County"],
  ["20", "A collection agency is regulated under the Fair Debt Collection Practices Act."],
  ["21", "Executives receive one to two weeks of pay per year of service."],
  ["22", "Quid pro quo harassment is unlawful even if the threatened consequence does not follow."],
  ["23", "The firm is led by Seth Katz and Craig Melinger."],
  ["24", "We recovered $250,000 for our client in unpaid overtime."],
  ["25", "Read [our guide](#) first."],
  ["26", "=== SEO FIELDS, FOR DEVELOPER ===\nPrimary keyword: x"],
  ["27", "What is the fee structure? Understand what you will pay."],
  ["27", "Most employment lawyers work on contingency."],
  ["27", "How much does a severance negotiation attorney cost?"],
  ["27", "You will receive a written fee agreement that clearly explains how fees and costs are handled."],
  ["15", "They must have given you something new, a raise or a promotion."],
  ["27es", "Trabajamos con honorarios contingentes."],
  ["28", "See New YorkC. Admin. Code § 8-107."],
  ["29", "📞 **(212) 460-0047**"],
  ["30", "This article contains general information and does not constitute legal advice."],
  ["31", "# Title\n\nNo byline here."],
];

const PASS: [string, string, TrapContext?][] = [
  // Kenneth's locked disclaimer must pass every trap (spec Trap 5 flagged it).
  ["*", `*${GENERAL_LEGAL_DISCLAIMER}*`],
  ["*", "**Call today at 212-460-0047 for a Free Confidential Case Evaluation.**"],
  // The spec's own corrected texts must pass every trap.
  ["*", "New Jersey courts recognize a public policy exception to at will employment, so an employer cannot fire you for refusing to break the law or for acting in line with a clear public policy (Pierce v. Ortho Pharmaceutical Corp., 84 N.J. 58 (1980)). New York courts generally do not recognize this exception under common law (Murphy v. American Home Products Corp., 58 N.Y.2d 293 (1983))."],
  ["*", "New York Labor Law § 740 protects employees who report, or refuse to take part in, conduct they reasonably believe violates a law, rule, or regulation, or poses a substantial and specific danger to public health or safety."],
  ["*", "In New York, an employer must give written notice of a change in your pay rate at least seven calendar days before it takes effect, unless the change appears on your wage statement (New York Labor Law § 195)."],
  ["*", "Settlement agreements usually include a release of claims. In New York, a settlement of a discrimination or harassment claim may include confidentiality only if that is the employee's preference (New York General Obligations Law § 5-336)."],
  ["*", "If you are under 40, federal law does not set a review period."],
  ["*", "Wage claims under the federal Fair Labor Standards Act generally cannot be waived in a private agreement without approval from a court or the Department of Labor."],
  ["*", "In New York and New Jersey, continued employment is generally enough consideration for a non compete."],
  ["*", "The Federal Trade Commission issued a national rule in April 2024 banning most non competes, but a federal court set it aside in 2024, and in September 2025 the FTC dropped its appeals."],
  ["*", "the bank must restrain the debtor's funds up to twice the amount of the judgment (CPLR 5222(b))."],
  ["*", "In New Jersey, cases may be filed in the Superior Court, Law Division, for claims above $20,000, or the Special Civil Part for claims of $20,000 or less."],
  ["*", "You generally have one year to file a complaint with the New York City Commission on Human Rights, or three years for gender based harassment.", harass],
  ["*", "The New York City Human Rights Law applies to employers with four or more employees for discrimination claims, and to employers of any size for gender based harassment claims.", harass],
  ["*", "Yes. The demand can still be unlawful harassment even if the threat is never carried out. Under federal law, an unfulfilled threat is usually analyzed as a hostile work environment claim."],
  // Narrowings Kenneth approved.
  ["15", "You will learn something new about your rights."],
  ["24", "We put our clients first."],
  ["27", "We offer a free consultation."],
  ["27", "The offer was contingent on a background check."],
  ["27", "How much does it cost to file in small claims court?"],
  ["27es", "Ofrecemos una consulta gratuita."],
  ["28", "See N.Y.C. Admin. Code § 8-107 and Murphy, 58 N.Y.2d 293."],
  ["31", "*Attorney Advertising*\n\n# Title\n\nBy Nicole Grunfeld, Katz Melinger PLLC\n\nText."],
  ["31", "**By Adam Sackowitz, Katz Melinger PLLC**"],
  // Scope: the harassment traps stay quiet outside harassment content.
  ["9", "The New York City Human Rights Law applies to employers with four or more employees.", { title: "Wage theft", isWebPage: true }],
  // Web-only traps never touch a social post.
  ["31", "Social caption with no byline.", { isWebPage: false }],
  ["7", "The firm represents workers.", { isWebPage: false }],
  // A link inside a sentence no longer hides it (Task 3) — and a link is not a hyphen.
  ["8", "See [our guide](https://katzmelinger.com/wage-and-hour-claims/) for more."],
];

let failures = 0;
for (const [n, text, ctx] of FIRE) {
  if (!traps[n]) {
    failures++;
    console.log(`FAIL no trap ${n}`);
  } else if (matchTrap(traps[n], text, ctx ?? { isWebPage: true }).length === 0) {
    failures++;
    console.log(`FAIL trap ${n} should fire: ${text.slice(0, 90)}`);
  }
}
for (const [n, text, ctx] of PASS) {
  const which = n === "*" ? Object.values(traps).filter((t) => t.matchType !== "document_missing") : [traps[n]];
  for (const t of which) {
    if (matchTrap(t, text, ctx ?? { isWebPage: true }).length > 0) {
      failures++;
      console.log(`FAIL trap ${t.id} should pass: ${text.slice(0, 90)}`);
    }
  }
}
console.log(`fixed cases: ${FIRE.length} fire, ${PASS.length} pass`);

// Task 14: drafts each trap matched on 2026-10-02 (8-character id prefixes).
const EXPECTED: Record<string, string[]> = {
  "2": ["2c33509b"], "2b": ["2c33509b"], "4": ["2c33509b"],
  "9": ["1c44ed5f", "fb684e7e", "3483b66f"], "10": ["1c44ed5f"],
  "11": ["1c44ed5f", "fefa8de5", "5b710c12", "fc3e5199"], "12": ["9b00932b"], "13": ["9b00932b"],
  "15": ["e70f280e", "5c4e2839", "f5416ef6", "d1115126"], "16": ["e70f280e", "5c4e2839"],
  "17": ["14f1c894"], "18": ["48d5e3f7"], "19": ["48d5e3f7"], "20": ["48d5e3f7"], "21": ["eb5d488b"],
  "22": ["1c44ed5f"], "23": ["1c44ed5f"], "25": ["91446913"], "26": ["5b710c12", "14f1c894"],
  "28": ["eb5d488b", "3483b66f"], "29": ["1c44ed5f", "58510cc0"], "30": ["48d5e3f7"],
  "27es": ["35acc071"],
  "27": ["48d5e3f7", "aa8fad36", "eb5d488b", "43fb024e", "91446913", "8b215505", "fc3e5199", "74108f45",
    "31014b9a", "35acc071", "246c200b", "95d80d4e", "bf522634", "1e92d0a9", "a9f419e2", "ef1e0135"],
};

const i = process.argv.indexOf("--snapshot");
if (i > 0) {
  type D = { id: string; title: string | null; topic: string | null; format: string; body: string | null; metadata: { primaryKeyword?: string; km_brief?: { primaryKeyword?: string } } | null };
  const drafts = JSON.parse(readFileSync(process.argv[i + 1], "utf8")) as D[];
  console.log(`\nsnapshot: ${drafts.length} drafts`);
  for (const [n, t] of Object.entries(traps)) {
    const hit = drafts
      .filter((d) =>
        matchTrap(t, d.body ?? "", {
          title: d.title,
          topic: d.topic,
          primaryKeyword: d.metadata?.primaryKeyword ?? d.metadata?.km_brief?.primaryKeyword ?? null,
          isWebPage: true,
        }).length > 0,
      )
      .map((d) => d.id.slice(0, 8));
    const want = EXPECTED[n] ?? [];
    const missing = want.filter((w) => !hit.includes(w));
    const extra = hit.filter((h) => !want.includes(h));
    const line = `trap ${n.padEnd(4)} ${String(hit.length).padStart(2)} drafts`;
    console.log(
      `${line}${missing.length ? `  MISSING ${missing.join(",")}` : ""}${extra.length ? `  extra ${extra.length <= 8 ? extra.join(",") : `${extra.length}`}` : ""}`,
    );
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall fixed cases passed");
process.exit(failures ? 1 : 0);
