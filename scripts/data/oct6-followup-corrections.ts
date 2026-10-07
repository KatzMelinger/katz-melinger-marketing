/**
 * Follow-up corrections drafted 2026-10-06 for the critical traps still firing
 * after the Task 12 run. NOT from Diana's spec: drafted by Claude for
 * Kenneth's review as the attorney. Applied with
 *   node scripts/run.mjs scripts/apply-oct6-corrections.ts --followup [--apply]
 *
 * Every find string was checked against the live body on 2026-10-06.
 */
import type { ChangeSource } from "../../lib/legal-fix-log";

export type FollowupOp = {
  draft_id: string;
  find?: string;
  replace: string;
  replace_all?: boolean;
  /** Move every <script type="application/ld+json"> block to metadata.schema_jsonld. */
  move_schema?: boolean;
  source: ChangeSource;
  reason: string;
};

const NY_HARASSMENT_STANDARD =
  "Under New York law, that standard no longer applies: since the 2019 amendments to the New York State Human Rights Law, harassment is unlawful when it subjects an employee to inferior terms or conditions of employment, unless it rises no higher than petty slights or trivial inconveniences.";

const GOL_5336 =
  "In New York, a settlement of a discrimination or harassment claim may include confidentiality only if that is the employee's preference (New York General Obligations Law § 5-336), and New Jersey law bars terms that conceal the details of such claims (N.J.S.A. 10:5-12.8).";

export const FOLLOWUP_OPS: FollowupOp[] = [
  // Non compete consideration (5c4e2839): continued employment is enough in NY and NJ.
  {
    draft_id: "5c4e2839",
    find: "If your employer asked you to sign one after you were already working, they must have given you something new, a raise, a promotion, severance pay, or another benefit.",
    replace: "If your employer asked you to sign one after you were already working, continued employment is generally enough consideration in New York and New Jersey, even if you received nothing else.",
    source: "knowledge base",
    reason: "Continued employment is generally sufficient consideration for a non compete in NY and NJ",
  },
  {
    draft_id: "5c4e2839",
    find: "No. The agreement must be supported by consideration. If you were already working and your employer asked you to sign a non-compete without offering anything new, it may not be enforceable.",
    replace: "Possibly. The agreement must be supported by consideration, but in New York and New Jersey continued employment generally counts, even if you signed after you started the job. The agreement can still fail for other reasons, for example if it reaches further than the employer's legitimate business interest.",
    source: "knowledge base",
    reason: "Continued employment is generally sufficient consideration for a non compete in NY and NJ",
  },
  // Old NYC sick leave start date (4f2e4830).
  {
    draft_id: "4f2e4830",
    find: "Employees begin accruing sick time on their first day of employment or on September 30, 2014, whichever is later.",
    replace: "Employees begin accruing sick time on their first day of employment.",
    source: "knowledge base",
    reason: "The September 30, 2014 start date is long past and only confuses the rule",
  },
  // Settlement confidentiality (fefa8de5, fc3e5199).
  {
    draft_id: "fefa8de5",
    find: "Settlement agreements typically include a release of claims and a confidentiality provision.",
    replace: `Settlement agreements typically include a release of claims. ${GOL_5336}`,
    source: "knowledge base",
    reason: "Confidentiality limits in NY and NJ settlements",
  },
  {
    draft_id: "fc3e5199",
    find: "Settlements may also include non-monetary terms such as a neutral reference, the removal of negative information from your personnel file, or a confidentiality provision.",
    replace: "Settlements may also include non-monetary terms such as a neutral reference, the removal of negative information from your personnel file, or a confidentiality provision, which New York allows for a discrimination or harassment claim only at the employee's preference (General Obligations Law § 5-336).",
    source: "knowledge base",
    reason: "Confidentiality limits in NY settlements",
  },
  // Severe or pervasive presented as the standard on New York pages.
  {
    draft_id: "fefa8de5",
    find: "A hostile work environment exists when unwelcome conduct based on a protected characteristic is severe or pervasive enough that a reasonable person would find the workplace intimidating, hostile, or abusive.",
    replace: `Under federal law, a hostile work environment exists when unwelcome conduct based on a protected characteristic is severe or pervasive enough that a reasonable person would find the workplace intimidating, hostile, or abusive. ${NY_HARASSMENT_STANDARD}`,
    source: "knowledge base",
    reason: "Severe or pervasive is the federal standard; the NYSHRL dropped it in 2019",
  },
  {
    draft_id: "31014b9a",
    find: "A hostile work environment exists when unwelcome conduct based on a protected characteristic is severe or pervasive enough to create an abusive working environment.",
    replace: `Under federal law, a hostile work environment exists when unwelcome conduct based on a protected characteristic is severe or pervasive enough to create an abusive working environment. ${NY_HARASSMENT_STANDARD}`,
    source: "knowledge base",
    reason: "Severe or pervasive is the federal standard; the NYSHRL dropped it in 2019",
  },
  // 60648452: coverage errors, plus the NY standard after the state law sentence.
  {
    draft_id: "60648452",
    find: "In New York, the New York State Human Rights Law (NYSHRL) and the [New York City Human Rights Law (NYCHRL)](https://www.nyc.gov/site/cchr/) apply to all employers regardless of size and provide broader protections than federal law. In New Jersey, the New Jersey Law Against Discrimination (NJLAD) covers employers with 15 or more employees and recognizes a wider range of protected classes than Title VII.",
    replace: `In New York, the New York State Human Rights Law (NYSHRL) applies to all employers regardless of size, and the [New York City Human Rights Law (NYCHRL)](https://www.nyc.gov/site/cchr/) applies to employers with four or more employees (and to employers of any size for gender based harassment). Both provide broader protections than federal law. ${NY_HARASSMENT_STANDARD} In New Jersey, the New Jersey Law Against Discrimination (NJLAD) covers employers of any size and recognizes a wider range of protected classes than Title VII.`,
    source: "knowledge base",
    reason: "NYCHRL covers 4 or more employees (any size for gender based harassment); NJLAD covers all employers; NYSHRL dropped severe or pervasive in 2019",
  },
  // NYSHRL threshold and personnel files (31014b9a).
  {
    draft_id: "31014b9a",
    find: "the New York State Human Rights Law (NYSHRL) applies to employers with four or more employees, and",
    replace: "the New York State Human Rights Law (NYSHRL) applies to all employers regardless of size, and",
    source: "knowledge base",
    reason: "The NYSHRL covers all employers regardless of size",
  },
  {
    draft_id: "31014b9a",
    find: "New York and New Jersey law give employees the right to inspect and copy their personnel files upon request.",
    replace: "New York and New Jersey law generally do not give private sector employees a right to see their personnel files, but you can still ask, and many employers agree.",
    source: "knowledge base",
    reason: "No general statutory right to inspect a personnel file in NY or NJ (private sector)",
  },
  // Fee language.
  {
    draft_id: "8b215505",
    find: " Katz Melinger PLLC discusses fee structures during the initial consultation.",
    replace: "",
    source: "firm fact",
    reason: "Fee rule: no statements about how the firm charges",
  },
  {
    draft_id: "74108f45",
    find: " If you decide to retain the firm, you will receive a written fee agreement that clearly explains how fees and costs are handled.",
    replace: "",
    source: "firm fact",
    reason: "Fee rule: no statements about how the firm charges",
  },
  // Superlative (aa8fad36).
  {
    draft_id: "aa8fad36",
    find: "If you are looking for the best employment lawyer in New York City for unpaid overtime,",
    replace: "If you are looking for the right employment lawyer in New York City for unpaid overtime,",
    source: "brand rule",
    reason: "No superlatives about lawyers (RPC 7.1)",
  },
  // Broken citation (3483b66f).
  {
    draft_id: "3483b66f",
    find: "New YorkC. Admin. Code",
    replace: "N.Y.C. Admin. Code",
    source: "brand rule",
    reason: "Citation restored",
  },
  // Placeholder testimonials: invented reviews must not publish. Removed until real reviews are supplied.
  {
    draft_id: "3483b66f",
    find: "## What Clients Say\n\n[PLACEHOLDER — Results — Replace before publishing]\n\"I came in with almost nothing documented and left knowing exactly what I had and what to do next. The outcome was better than I expected.\"\nA.R., Midtown Manhattan — Google Review\n\n[PLACEHOLDER — Empathy — Replace before publishing]\n\"I had reported internally and been told nothing happened. Katz Melinger explained why that was not the end of the road. I felt heard for the first time.\"\nM.T., Brooklyn — Google Review\n\n[PLACEHOLDER — Local Knowledge — Replace before publishing]\n\"They knew exactly which agency to file with and why. That decision made a real difference in how quickly things moved.\"\nJ.L., Westchester County — Google Review\n\n",
    replace: "",
    source: "firm fact",
    reason: "Placeholder testimonials are invented reviews; removed until real Google reviews are supplied",
  },
  {
    draft_id: "58510cc0",
    find: "What clients say\nResults\n★★★★★\n“[PLACEHOLDER] They did not overpromise. They laid out the pressure points, moved quickly when it mattered, and helped me see the case clearly before the employer could box me in.”\n\n[A.B.], Manhattan · Google Review\n\nEmpathy\n★★★★★\n“[PLACEHOLDER] I did not feel pushed. I felt understood. They answered the question underneath all my other questions, which was whether I was allowed to take what happened seriously.”\n\n[J.R.], Queens · Google Review\n\nLocal Knowledge\n★★★★★\n“[PLACEHOLDER] They knew the city process, the timing issues, and where my case could get stronger or weaker. That changed how I approached everything.”\n\n[M.S.], Nassau County · Google Review\n\n",
    replace: "",
    source: "firm fact",
    reason: "Placeholder testimonials are invented reviews; removed until real Google reviews are supplied",
  },
  // Outcome size (58510cc0).
  {
    draft_id: "58510cc0",
    find: "The result was a six-figure settlement reported by the firm as equivalent to more than eight years of the employee's annual salary.",
    replace: "The matter was resolved through a negotiated settlement.",
    source: "brand rule",
    reason: "No outcome sizes in advertising (RPC 7.1)",
  },
  // Schema code in the body (43fb024e): Task 8.
  {
    draft_id: "43fb024e",
    move_schema: true,
    replace: "",
    source: "brand rule",
    reason: "Schema (JSON LD) moved out of the body into metadata.schema_jsonld (Task 8)",
  },
];
