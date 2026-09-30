/**
 * The statute table (Diana's Sept 28 spec, section 3 and Appendix A), and the
 * pure matcher that checks a cited section against what it actually covers.
 *
 * WHY A SEPARATE CHECK
 *
 * The wage-draft errors in the audit were not wrong numbers. They were real
 * statutes cited for the wrong thing: "Section 196-d, which governs tip credit
 * rules" (196-d is about keeping tips; the tip credit is in Part 146), "Under
 * Section 198-c, employees cannot waive wage claims" (198-c is about benefits
 * and wage supplements). A value check cannot see that. This compares the
 * sentence a citation sits in with the table's "what it does NOT cover".
 *
 * HOW A ROW DECIDES
 *
 *   mismatch  words that, in the same sentence as the citation, mean the draft
 *             is using the section for something it does not cover. Taken from
 *             the "does NOT cover (seen in drafts)" column — the errors that
 *             actually happened, not a guess at every possible misuse.
 *   unless    words that make that same sentence correct after all (usually a
 *             negation: "198-c does NOT concern waivers" is right).
 *
 * A cited section the table does not know is "unverified citation": routed to
 * an attorney, never passed silently and never blocking on its own.
 *
 * THE DATA IS NOT LIVE UNTIL AN ATTORNEY SIGNS IT OFF
 *
 * Diana's Appendix A says an attorney initials the table before it is loaded.
 * So this file is the reviewed SOURCE, scripts/emit-statute-table-sql.ts turns
 * it into supabase/legal_statute_table.sql, and the check reads the DATABASE.
 * With the table empty the check does nothing at all — an unreviewed table
 * must not start raising Critical findings.
 *
 * "attorney client" and "196 d" spacing in the notes follow the firm's no-dash
 * style; aliases cover hyphen, space and parenthesis forms (196-d, 196 d, 196(d)).
 */

export type StatuteCode =
  | "NYLL"
  | "NYCRR"
  | "USC29"
  | "USC42"
  | "USC9"
  | "EXEC"
  | "CPLR"
  | "NYCADMIN"
  | "NJSA"
  | "CFR29"
  | "WCL"
  | "GOL"
  | "CSL";

export type StatuteRow = {
  key: string;
  code: StatuteCode;
  citation: string;
  aliases: string[];
  covers: string;
  notCovers: string | null;
  mismatch: string[];
  unless: string[];
  sourceUrl: string;
};

/** Words in a sentence that say which body of law a bare section number belongs to. */
export const CODE_CONTEXT: Record<StatuteCode, RegExp> = {
  NYLL: /\blabor\s+law\b|\bNYLL\b|\bLab\.?\s+Law\b/i,
  NYCRR: /\bNYCRR\b|\bwage\s+order\b|\bN\.Y\.C\.R\.R\b/i,
  USC29: /\b29\s+U\.?S\.?C\b|\bFLSA\b|\bFair\s+Labor\s+Standards\b|\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\b|\bADEA\b|\bOSHA?\b|\bOSH\s+Act\b|\bOccupational\s+Safety\b/i,
  USC42: /\b42\s+U\.?S\.?C\b|\bTitle\s+VII\b|\bADA\b|\bAmericans\s+with\s+Disabilities\b/i,
  USC9: /\b9\s+U\.?S\.?C\b|\bEFAA\b|\bEnding\s+Forced\s+Arbitration\b/i,
  EXEC: /\bExecutive\s+Law\b|\bExec\.?\s+Law\b|\bNYSHRL\b|\bState\s+Human\s+Rights\s+Law\b/i,
  CPLR: /\bCPLR\b|\bCivil\s+Practice\s+Law\b/i,
  NYCADMIN: /\bAdmin(?:istrative)?\.?\s+Code\b|\bNYCHRL\b|\bCity\s+Human\s+Rights\s+Law\b|\bEarned\s+Safe\s+and\s+Sick\b/i,
  NJSA: /\bN\.?J\.?S\.?A\b|\bNJLAD\b|\bLaw\s+Against\s+Discrimination\b/i,
  CFR29: /\bC\.?F\.?R\b/i,
  WCL: /\bWorkers['’]?\s+Comp(?:ensation)?\s+Law\b|\bWCL\b/i,
  GOL: /\bGeneral\s+Obligations\s+Law\b|\bGOL\b/i,
  CSL: /\bCivil\s+Service\s+Law\b/i,
};

const NYS = (s: string) => `https://www.nysenate.gov/legislation/laws/${s}`;
const CORNELL = (s: string) => `https://www.law.cornell.edu/uscode/text/${s}`;

/**
 * Appendix A, transcribed. The `mismatch` / `unless` columns are engineering's
 * reading of Diana's "does NOT cover (seen in drafts)" column; everything else
 * is hers. Two rows are additions, marked: "Article 6" (her section 2 test set
 * — overtime cited to Article 6) and "Article 19".
 */
export const STATUTE_TABLE: StatuteRow[] = [
  // --- A1. New York Labor Law and wage orders ------------------------------
  {
    key: "nyll-art6", code: "NYLL", citation: "NY Labor Law Article 6",
    aliases: ["Article 6"],
    covers: "Payment of wages (sections 190 to 199 A): pay frequency, deductions, wage notices and statements, and wage claim remedies.",
    notCovers: "Overtime. New York overtime is set by the wage orders under Article 19 (12 NYCRR 142 2.2).",
    mismatch: ["overtime"], unless: ["not", "Article 19"],
    sourceUrl: NYS("LAB/A6"),
  },
  {
    key: "nyll-art19", code: "NYLL", citation: "NY Labor Law Article 19",
    aliases: ["Article 19"],
    covers: "Minimum Wage Act (sections 650 to 665), under which the wage orders set minimum wage and overtime.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: NYS("LAB/A19"),
  },
  {
    key: "nyll-191", code: "NYLL", citation: "NY Labor Law § 191",
    aliases: ["191"],
    covers: "How often wages must be paid: manual workers weekly (not later than 7 days after the week ends); clerical and other workers at least twice a month; commissioned salespersons under a written agreement.",
    notCovers: "Overtime or minimum wage amounts.",
    mismatch: ["overtime rate", "minimum wage rate", "time and a half"], unless: [],
    sourceUrl: NYS("LAB/191"),
  },
  {
    key: "nyll-193", code: "NYLL", citation: "NY Labor Law § 193",
    aliases: ["193"],
    covers: "Bars deductions from wages except those required by law or expressly authorized in writing by the employee for the employee's benefit in the categories the law lists (for example insurance, pension, union dues).",
    notCovers: "That uniform, cash shortage, breakage or walkout deductions are allowed with written consent. They are not.",
    mismatch: ["uniform", "cash shortage", "breakage", "walkout"],
    unless: ["not", "prohibit", "bar", "cannot", "may not", "even if", "even with"],
    sourceUrl: NYS("LAB/193"),
  },
  {
    key: "nyll-195", code: "NYLL", citation: "NY Labor Law § 195",
    aliases: ["195", "195(1)", "195(3)", "195(4)"],
    covers: "Employer notice and records: wage notice at hire (195(1)); wage statement with every payment (195(3)); keep payroll records for six years (195(4)).",
    notCovers: "A right for private employees to inspect their personnel file.",
    mismatch: ["personnel file"], unless: ["no right", "not give", "does not", "no general"],
    sourceUrl: NYS("LAB/195"),
  },
  {
    key: "nyll-196b", code: "NYLL", citation: "NY Labor Law § 196 b",
    aliases: ["196-b", "196(b)"],
    covers: "New York State paid sick leave: 1 hour per 30 hours worked; up to 40 or 56 hours a year depending on employer size; paid or unpaid for the smallest employers depending on net income.",
    notCovers: "New York City safe and sick time (that is NYC Admin. Code § 20 911 and following).",
    mismatch: ["Earned Safe and Sick Time", "safe and sick time"], unless: ["separate", "not", "also"],
    sourceUrl: NYS("LAB/196-B"),
  },
  {
    key: "nyll-196d", code: "NYLL", citation: "NY Labor Law § 196 d",
    aliases: ["196-d", "196(d)"],
    covers: "Gratuities: an employer or its agents (including managers) may not demand, accept or keep any part of an employee's tips.",
    notCovers: "The tip credit (that is in 12 NYCRR Part 146).",
    mismatch: ["tip credit"], unless: ["not the tip credit", "separate", "Part 146"],
    sourceUrl: NYS("LAB/196-D"),
  },
  {
    key: "nyll-198", code: "NYLL", citation: "NY Labor Law § 198",
    aliases: ["198", "198(1-a)", "198(1-b)", "198(1-d)", "198(3)"],
    covers: "Remedies for wage claims: unpaid wages, liquidated damages of 100 percent, prejudgment interest; wage notice damages of $50 per workday up to $5,000 (198(1 b)); wage statement damages of $250 per workday up to $5,000 (198(1 d)); six year limitations period (198(3)).",
    notCovers: "\"$250 per violation\"; that remedies are only available in a lawsuit.",
    mismatch: ["per violation", "only available through a lawsuit", "only through a lawsuit", "only in a lawsuit"],
    unless: [],
    sourceUrl: NYS("LAB/198"),
  },
  {
    key: "nyll-198c", code: "NYLL", citation: "NY Labor Law § 198 c",
    aliases: ["198-c", "198(c)"],
    covers: "Benefits and wage supplements (for example vacation pay, holiday pay, reimbursements): failure to pay within 30 days after they are due is a misdemeanor; does not apply to executive, administrative or professional employees earning over $1,300 a week.",
    notCovers: "Any rule about waiving wage claims or releases.",
    mismatch: ["waive", "waiver", "release"], unless: ["does not", "not about", "nothing to do"],
    sourceUrl: NYS("LAB/198-C"),
  },
  {
    key: "nyll-215", code: "NYLL", citation: "NY Labor Law § 215",
    aliases: ["215"],
    covers: "Retaliation for complaining about a Labor Law violation; liquidated damages up to $20,000, lost compensation, front pay and reinstatement; two year limitations period.",
    notCovers: "General whistleblowing about non Labor Law issues (that is § 740).",
    mismatch: ["public health", "public safety"], unless: [],
    sourceUrl: NYS("LAB/215"),
  },
  {
    key: "nyll-218", code: "NYLL", citation: "NY Labor Law § 218",
    aliases: ["218"],
    covers: "Department of Labor orders to comply, which can include unpaid wages, liquidated damages, interest and civil penalties.",
    notCovers: "A statement that the Department of Labor cannot award liquidated damages or interest.",
    mismatch: ["cannot award", "only available through a lawsuit", "only through a lawsuit"], unless: [],
    sourceUrl: NYS("LAB/218"),
  },
  {
    key: "nyll-652", code: "NYLL", citation: "NY Labor Law § 652",
    aliases: ["652"],
    covers: "Minimum wage rates (see the knowledge base for current values).",
    notCovers: "Overtime rules.",
    mismatch: ["overtime"], unless: ["not"],
    sourceUrl: NYS("LAB/652"),
  },
  {
    key: "nyll-663", code: "NYLL", citation: "NY Labor Law § 663",
    aliases: ["663", "663(3)"],
    covers: "Civil action under the Minimum Wage Act, including a six year limitations period (663(3)).",
    notCovers: "Tip rules; paid sick leave.",
    mismatch: ["sick leave", "tip pooling", "tip sharing"], unless: [],
    sourceUrl: NYS("LAB/663"),
  },
  {
    key: "nyll-740", code: "NYLL", citation: "NY Labor Law § 740",
    aliases: ["740"],
    covers: "Private sector whistleblower protection: employees, former employees and independent contractors who disclose or threaten to disclose conduct they reasonably believe violates a law, rule or regulation or poses a substantial and specific danger to public health or safety; two year limitations period; remedies include reinstatement, back pay, front pay, punitive damages if willful, malicious or wanton, and a civil penalty up to $10,000.",
    notCovers: "Public employees (that is Civil Service Law § 75 b).",
    mismatch: ["public employee", "government employee"], unless: ["not", "75-b", "75 b"],
    sourceUrl: NYS("LAB/740"),
  },
  {
    key: "csl-75b", code: "CSL", citation: "NY Civil Service Law § 75 b",
    aliases: ["75-b"],
    covers: "Whistleblower protection for public employees.",
    notCovers: "Private employees.",
    mismatch: ["private employee", "private sector"], unless: ["not", "740"],
    sourceUrl: NYS("CVS/75-B"),
  },
  {
    key: "nycrr-142-2.2", code: "NYCRR", citation: "12 NYCRR § 142 2.2",
    aliases: ["142-2.2"],
    covers: "Overtime at one and a half times the regular rate for hours over 40 in a workweek (Miscellaneous Industries Wage Order).",
    notCovers: "New York Labor Law \"Article 6\" as the source of overtime.",
    mismatch: [], unless: [],
    sourceUrl: "https://dol.ny.gov/",
  },
  {
    key: "nycrr-142-2.4", code: "NYCRR", citation: "12 NYCRR § 142 2.4",
    aliases: ["142-2.4"],
    covers: "Spread of hours: one extra hour at the minimum wage when the workday spans more than 10 hours; under this order it applies to employees paid at or near the minimum wage.",
    notCovers: "That every employee, at any pay rate, gets spread of hours pay.",
    mismatch: ["every employee", "all employees", "regardless of pay", "any pay rate", "regardless of how much"],
    unless: ["not"],
    sourceUrl: "https://dol.ny.gov/",
  },
  {
    key: "nycrr-146", code: "NYCRR", citation: "12 NYCRR Part 146",
    aliases: ["Part 146", "146-1.6", "Hospitality Wage Order", "Hospitality Industry Wage Order"],
    covers: "Hospitality Industry Wage Order: tip credits and tip pooling rules; spread of hours for all hospitality employees (146 1.6); uniform maintenance.",
    notCovers: "Non hospitality industries.",
    mismatch: ["retail", "construction", "office workers"], unless: ["not"],
    sourceUrl: "https://dol.ny.gov/",
  },
  {
    key: "gol-5-336", code: "GOL", citation: "NY General Obligations Law § 5 336",
    aliases: ["5-336"],
    covers: "Limits on nondisclosure terms in settlements and agreements about discrimination, harassment and retaliation.",
    notCovers: "A total ban on all confidentiality clauses.",
    mismatch: ["bans all confidentiality", "all confidentiality clauses are", "any confidentiality clause is void"],
    unless: ["not"],
    sourceUrl: NYS("GOB/5-336"),
  },
  // --- A2. Federal wage and leave law --------------------------------------
  {
    key: "usc29-206", code: "USC29", citation: "29 U.S.C. § 206",
    aliases: ["206"],
    covers: "Federal minimum wage ($7.25 an hour).",
    notCovers: "Overtime.",
    mismatch: ["overtime"], unless: ["207", "not"],
    sourceUrl: CORNELL("29/206"),
  },
  {
    key: "usc29-207", code: "USC29", citation: "29 U.S.C. § 207",
    aliases: ["207"],
    covers: "Federal overtime: one and a half times the regular rate over 40 hours in a workweek; each workweek stands alone.",
    notCovers: "Averaging hours across two weeks.",
    mismatch: ["averag", "two-week period", "two week period", "biweekly period"], unless: ["not", "cannot", "may not"],
    sourceUrl: CORNELL("29/207"),
  },
  {
    key: "usc29-213", code: "USC29", citation: "29 U.S.C. § 213",
    aliases: ["213"],
    covers: "FLSA exemptions (executive, administrative, professional, outside sales, certain computer employees and others).",
    notCovers: "That a job title alone creates an exemption.",
    mismatch: ["job title"], unless: ["not", "alone does not", "doesn't"],
    sourceUrl: CORNELL("29/213"),
  },
  {
    key: "usc29-215a3", code: "USC29", citation: "29 U.S.C. § 215(a)(3)",
    aliases: ["215(a)(3)"],
    covers: "FLSA anti retaliation.",
    notCovers: "New York Labor Law § 215.",
    mismatch: [], unless: [],
    sourceUrl: CORNELL("29/215"),
  },
  {
    key: "usc29-216b", code: "USC29", citation: "29 U.S.C. § 216(b)",
    aliases: ["216(b)"],
    covers: "Private lawsuit for unpaid minimum wage or overtime, liquidated damages equal to the unpaid amount, and collective actions.",
    notCovers: "A limitations period.",
    mismatch: ["statute of limitations", "limitations period", "years to file", "deadline"], unless: ["255"],
    sourceUrl: CORNELL("29/216"),
  },
  {
    key: "usc29-255", code: "USC29", citation: "29 U.S.C. § 255(a)",
    aliases: ["255(a)", "255"],
    covers: "FLSA limitations: two years, three years if the violation was willful.",
    notCovers: "Six years (that is New York law).",
    mismatch: ["six years", "6 years"], unless: ["New York", "NYLL", "Labor Law"],
    sourceUrl: CORNELL("29/255"),
  },
  {
    key: "usc29-260", code: "USC29", citation: "29 U.S.C. § 260",
    aliases: ["260"],
    covers: "Good faith defense that lets a court reduce or deny FLSA liquidated damages.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/260"),
  },
  {
    key: "usc29-2611-2a", code: "USC29", citation: "29 U.S.C. § 2611(2)(A)",
    aliases: ["2611(2)(A)", "2611(2)(A)(i)", "2611(2)(A)(ii)"],
    covers: "FMLA eligible employee: 12 months of employment and 1,250 hours in the prior 12 months.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/2611"),
  },
  {
    key: "usc29-2611-2b-ii", code: "USC29", citation: "29 U.S.C. § 2611(2)(B)(ii)",
    aliases: ["2611(2)(B)(ii)"],
    covers: "FMLA site rule: excludes employees at a worksite where the employer has fewer than 50 employees within 75 miles.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/2611"),
  },
  {
    key: "usc29-2611-4", code: "USC29", citation: "29 U.S.C. § 2611(4)(A)(i)",
    aliases: ["2611(4)", "2611(4)(A)(i)"],
    covers: "Definition of a covered employer: 50 or more employees in each of 20 or more workweeks in the current or preceding year.",
    notCovers: "The 50 within 75 miles employee rule (that is 2611(2)(B)(ii)).",
    mismatch: ["75 miles", "75-mile", "75 mile"], unless: ["2611(2)"],
    sourceUrl: CORNELL("29/2611"),
  },
  {
    key: "usc29-2612", code: "USC29", citation: "29 U.S.C. § 2612",
    aliases: ["2612", "2612(d)(2)"],
    covers: "Leave entitlement (12 weeks); intermittent leave; an employer may require substitution of accrued paid leave (2612(d)(2)).",
    notCovers: "That an employer cannot require paid leave to run with FMLA leave.",
    mismatch: ["cannot require", "may not require", "can't require", "may not force", "cannot force"], unless: [],
    sourceUrl: CORNELL("29/2612"),
  },
  {
    key: "usc29-2614", code: "USC29", citation: "29 U.S.C. § 2614",
    aliases: ["2614"],
    covers: "Restoration to the same or an equivalent position after leave.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/2614"),
  },
  {
    key: "usc29-2615", code: "USC29", citation: "29 U.S.C. § 2615",
    aliases: ["2615"],
    covers: "Prohibited acts: interference with FMLA rights and retaliation.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/2615"),
  },
  {
    key: "usc29-2617", code: "USC29", citation: "29 U.S.C. § 2617",
    aliases: ["2617", "2617(a)", "2617(b)", "2617(c)"],
    covers: "FMLA enforcement: lawsuit for lost wages and benefits, interest, and liquidated damages equal to that amount unless the employer shows good faith (2617(a)); complaints to the U.S. Department of Labor (2617(b)); two years, three if willful (2617(c)).",
    notCovers: "Filing with the EEOC or under Title VII; liquidated damages only for willful violations.",
    mismatch: ["EEOC", "Title VII", "only if willful", "only for willful", "only if the violation was willful"],
    unless: ["not", "rather than"],
    sourceUrl: CORNELL("29/2617"),
  },
  // Added at attorney review, 2026-09-30. The knowledge base already checks the
  // 30-day OSHA deadline; this row catches the claim the number check cannot:
  // that an employee can sue. There is no private right of action under 11(c)
  // (case law; e.g. Taylor v. Brighton Corp., 616 F.2d 256 (6th Cir. 1980)) —
  // only the Secretary of Labor sues. Bare "11(c)" is NOT an alias: it is a
  // common subsection number elsewhere (Rule 11(c) sanctions), so every 11(c)
  // form names OSHA or the OSH Act.
  {
    key: "usc29-660c", code: "USC29", citation: "29 U.S.C. § 660(c) (OSH Act section 11(c))",
    aliases: [
      "660(c)", "660(c)(1)", "660(c)(2)",
      "OSHA 11(c)", "OSHA section 11(c)", "OSH Act 11(c)", "OSH Act section 11(c)",
      "section 11(c) of the OSH Act", "section 11(c) of the Occupational Safety and Health Act",
    ],
    covers: "Bars retaliation for safety complaints. The employee files a complaint with OSHA within 30 days; only the Secretary of Labor may sue. No private lawsuit.",
    notCovers: "A lawsuit filed by the employee. (For a private suit, private-sector workers in New York use Labor Law § 740.)",
    mismatch: ["sue", "lawsuit", "in court", "file a claim in court"],
    unless: ["Secretary", "Department of Labor", "no private", "cannot sue", "740"],
    sourceUrl: CORNELL("29/660"),
  },
  {
    key: "cfr29-825.307", code: "CFR29", citation: "29 CFR § 825.307",
    aliases: ["825.307"],
    covers: "Authentication and clarification of medical certification; the employee's direct supervisor may never contact the health care provider.",
    notCovers: "That the employer can never contact the provider in any way.",
    mismatch: ["employer can never contact", "employer may never contact", "employer cannot contact"], unless: [],
    sourceUrl: "https://www.ecfr.gov/current/title-29/part-825/section-825.307",
  },
  {
    key: "usc9-401", code: "USC9", citation: "9 U.S.C. §§ 401 and 402",
    aliases: ["401", "402"],
    covers: "For sexual harassment and sexual assault claims, the employee may choose court instead of a predispute arbitration agreement (in effect since March 3, 2022, for claims arising or accruing on or after that date).",
    notCovers: "Other discrimination claims.",
    mismatch: ["age discrimination", "race discrimination", "disability discrimination"], unless: [],
    sourceUrl: CORNELL("9/402"),
  },
  // --- A3. Discrimination, harassment and leave laws -----------------------
  {
    key: "exec-292-5", code: "EXEC", citation: "NY Executive Law § 292(5)",
    aliases: ["292(5)", "292"],
    covers: "NYSHRL employer definition: all employers, regardless of size (since February 8, 2020).",
    notCovers: "\"Four or more employees.\"",
    mismatch: ["four or more", "4 or more", "15 or more", "fifteen or more"], unless: ["NYCHRL", "City Human Rights"],
    sourceUrl: NYS("EXC/292"),
  },
  {
    key: "exec-296", code: "EXEC", citation: "NY Executive Law § 296",
    aliases: ["296"],
    covers: "NYSHRL unlawful discriminatory practices, including retaliation.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: NYS("EXC/296"),
  },
  {
    key: "exec-297", code: "EXEC", citation: "NY Executive Law § 297",
    aliases: ["297", "297(5)", "297(9)"],
    covers: "Division of Human Rights complaints: three years for conduct on or after February 15, 2024 (297(5)); lawsuit in court and election of remedies (297(9)).",
    notCovers: "\"One year\" for current conduct.",
    mismatch: ["one year", "1 year", "one-year"], unless: ["before February", "prior to February", "before 2024"],
    sourceUrl: NYS("EXC/297"),
  },
  {
    key: "exec-300", code: "EXEC", citation: "NY Executive Law § 300",
    aliases: ["300"],
    covers: "Liberal construction of NYSHRL which means harassment is unlawful regardless of whether it is severe or pervasive, unless it is no more than petty slights or trivial inconveniences.",
    notCovers: "A \"severe or pervasive\" requirement under New York State law.",
    // "Title VII", "federal law", "unlike", "lower": attorney review 2026-09-30,
    // so a correct federal-versus-New-York comparison is not flagged. Plain
    // "federal" is deliberately NOT here ("under § 300, as under federal law,
    // it must be severe or pervasive" is wrong and must still be caught).
    mismatch: ["severe or pervasive"],
    unless: ["no longer", "does not require", "not required", "need not", "regardless", "Title VII", "federal law", "unlike", "lower"],
    sourceUrl: NYS("EXC/300"),
  },
  {
    key: "cplr-214-2", code: "CPLR", citation: "NY CPLR § 214(2)",
    aliases: ["214(2)"],
    covers: "Three year limitations period for NYSHRL lawsuits in court.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: NYS("CVP/214"),
  },
  {
    key: "nycadmin-8-102", code: "NYCADMIN", citation: "NYC Admin. Code § 8 102",
    aliases: ["8-102"],
    covers: "NYCHRL definitions: employer means four or more employees, but for gender based harassment claims all employers are covered.",
    notCovers: "\"One or more employees\" for general discrimination.",
    mismatch: ["one or more employees", "1 or more employees"], unless: ["gender", "harassment"],
    sourceUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-5007",
  },
  {
    key: "nycadmin-8-107", code: "NYCADMIN", citation: "NYC Admin. Code § 8 107",
    aliases: ["8-107"],
    covers: "NYCHRL unlawful discriminatory practices, including retaliation and caregiver status.",
    notCovers: "FMLA leave as a protected category by itself.",
    mismatch: ["FMLA leave"], unless: ["not"],
    sourceUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-5007",
  },
  {
    key: "nycadmin-8-109", code: "NYCADMIN", citation: "NYC Admin. Code § 8 109(e)",
    aliases: ["8-109", "8-109(e)"],
    covers: "Commission on Human Rights complaint deadline: one year, or three years for gender based harassment.",
    notCovers: "\"Three years\" for all Commission complaints.",
    mismatch: ["three years", "3 years"], unless: ["gender", "one year", "1 year"],
    sourceUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-5007",
  },
  {
    key: "nycadmin-8-502", code: "NYCADMIN", citation: "NYC Admin. Code § 8 502",
    aliases: ["8-502", "8-502(d)"],
    covers: "Private lawsuit under the NYCHRL; three year limitations period (8 502(d)).",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-5007",
  },
  {
    key: "nycadmin-8-130", code: "NYCADMIN", citation: "NYC Admin. Code § 8 130",
    aliases: ["8-130"],
    covers: "NYCHRL must be construed liberally, independently of federal and state law; standard is \"treated less well, at least in part, because of\" a protected characteristic.",
    notCovers: "A \"motivating factor\" test or a rule that any differential treatment is enough.",
    mismatch: ["motivating factor"], unless: ["not"],
    sourceUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-5007",
  },
  {
    key: "nycadmin-20-911", code: "NYCADMIN", citation: "NYC Admin. Code § 20 911 and following",
    aliases: ["20-911", "Earned Safe and Sick Time Act", "ESSTA"],
    covers: "New York City safe and sick time; balance shown on each pay statement. (Coverage threshold and the February 2026 amendments need attorney confirmation before relying on them.)",
    notCovers: "A 120 day waiting period or \"September 30, 2014\" start date as current rules.",
    mismatch: ["120 day", "120-day", "September 30, 2014"], unless: ["no longer", "originally", "used to"],
    sourceUrl: "https://www.nyc.gov/site/dca/about/paid-sick-leave-FAQs.page",
  },
  {
    key: "wcl-120", code: "WCL", citation: "NY Workers' Compensation Law § 120",
    aliases: ["120"],
    covers: "Retaliation and discrimination complaints to the Workers' Compensation Board, including for Paid Family Leave.",
    notCovers: "A lawsuit in court for Paid Family Leave retaliation.",
    mismatch: ["in court", "lawsuit"], unless: ["not", "rather than"],
    sourceUrl: NYS("WKC/120"),
  },
  {
    key: "wcl-203b", code: "WCL", citation: "NY Workers' Compensation Law § 203 b",
    aliases: ["203-b"],
    covers: "Paid Family Leave job restoration.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: NYS("WKC/203-B"),
  },
  {
    key: "nycrr-380", code: "NYCRR", citation: "12 NYCRR Part 380",
    aliases: ["Part 380"],
    covers: "Paid Family Leave regulations: eligibility (26 consecutive weeks at 20 or more hours, or 175 days), benefits, disputes by arbitration.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: "https://paidfamilyleave.ny.gov/",
  },
  {
    key: "njsa-10-5-5", code: "NJSA", citation: "N.J.S.A. 10:5 5(e)",
    aliases: ["10:5-5", "10:5-5(e)"],
    covers: "NJLAD employer definition: all employers regardless of size.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: "https://lis.njleg.state.nj.us/",
  },
  {
    key: "njsa-10-5-12", code: "NJSA", citation: "N.J.S.A. 10:5 12",
    aliases: ["10:5-12"],
    covers: "NJLAD unlawful employment practices, including retaliation.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: "https://lis.njleg.state.nj.us/",
  },
  {
    key: "njsa-10-5-18", code: "NJSA", citation: "N.J.S.A. 10:5 18",
    aliases: ["10:5-18"],
    covers: "New Jersey Division on Civil Rights complaints within 180 days (court claims have two years under case law).",
    notCovers: "\"New Jersey Department of Civil Rights.\"",
    mismatch: ["Department of Civil Rights"], unless: [],
    sourceUrl: "https://lis.njleg.state.nj.us/",
  },
  {
    key: "njsa-34-11d", code: "NJSA", citation: "N.J.S.A. 34:11D 1 and following",
    aliases: ["34:11D", "New Jersey Earned Sick Leave Law"],
    covers: "New Jersey earned sick leave: all employers; 1 hour per 30 hours; up to 40 hours a year; use can start on day 120.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: "https://www.nj.gov/labor/myworkrights/leave-benefits/sick-leave/",
  },
  {
    key: "usc42-2000e-b", code: "USC42", citation: "42 U.S.C. § 2000e(b)",
    aliases: ["2000e(b)"],
    covers: "Title VII employer definition: 15 or more employees.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("42/2000e"),
  },
  {
    key: "usc42-2000e-2", code: "USC42", citation: "42 U.S.C. § 2000e 2 and 2000e 3(a)",
    aliases: ["2000e-2", "2000e-3", "2000e-3(a)"],
    covers: "Title VII unlawful practices and retaliation.",
    notCovers: "FMLA leave.",
    mismatch: ["FMLA"], unless: ["not", "separate"],
    sourceUrl: CORNELL("42/2000e-2"),
  },
  {
    key: "usc42-2000e-5", code: "USC42", citation: "42 U.S.C. § 2000e 5(e)(1) and (f)(1)",
    aliases: ["2000e-5", "2000e-5(e)(1)", "2000e-5(f)(1)"],
    covers: "EEOC charge within 180 days, or 300 days where a state or local agency exists (New York and New Jersey: 300); lawsuit within 90 days of the right to sue notice.",
    notCovers: "FMLA claims.",
    mismatch: ["FMLA"], unless: ["not", "separate"],
    sourceUrl: CORNELL("42/2000e-5"),
  },
  {
    key: "usc42-1981a", code: "USC42", citation: "42 U.S.C. § 1981a(b)(3)",
    aliases: ["1981a", "1981a(b)(3)"],
    covers: "Caps on combined compensatory and punitive damages under Title VII and the ADA: $50,000 (15 to 100 employees), $100,000 (101 to 200), $200,000 (201 to 500), $300,000 (over 500).",
    notCovers: "Caps under the NYSHRL, NYCHRL or NJLAD (there are none).",
    mismatch: ["NYSHRL", "NYCHRL", "NJLAD", "State Human Rights Law", "City Human Rights Law", "Law Against Discrimination"],
    unless: ["no cap", "not capped", "no such cap", "uncapped", "does not apply", "no limit"],
    sourceUrl: CORNELL("42/1981a"),
  },
  {
    key: "usc29-630b", code: "USC29", citation: "29 U.S.C. § 630(b), ADEA",
    aliases: ["630(b)"],
    covers: "ADEA employer definition: 20 or more employees; protects workers 40 and older.",
    notCovers: null, mismatch: [], unless: [],
    sourceUrl: CORNELL("29/630"),
  },
  {
    key: "usc42-12111", code: "USC42", citation: "42 U.S.C. § 12111(5)",
    aliases: ["12111", "12111(5)"],
    covers: "ADA employer definition: 15 or more employees.",
    notCovers: "\"More than 15 employees.\"",
    mismatch: ["more than 15", "more than fifteen"], unless: [],
    sourceUrl: CORNELL("42/12111"),
  },
];

/* -------------------------------------------------------------------------- */
/* Matcher (pure)                                                              */
/* -------------------------------------------------------------------------- */

export type StatuteHit =
  | { kind: "mismatch"; row: StatuteRow; term: string; sentence: string; matched: string }
  | { kind: "unverified"; citation: string; sentence: string };

const esc = (s: string) => s.replace(/[.*+?^${}|[\]\\]/g, "\\$&");

/** "196-d" -> matches 196-d, 196 d, 196(d), 196d. Parentheses and separators are optional. */
function aliasSource(alias: string): string {
  const parts = alias.split(/[-\s()]+/).filter(Boolean).map(esc);
  return parts.join("[-\\s()]*") + (/[)]$/.test(alias) ? "\\)?" : "");
}

/** A bare section number only counts after "§" or "Section" — "191" alone is a number, not a citation. */
const PREFIX = "(?:§{1,2}\\s*|\\b[Ss]ections?\\s+|\\bSec\\.\\s*)";

type CompiledAlias = { row: StatuteRow; re: RegExp; len: number };

export function compileTable(rows: readonly StatuteRow[]): CompiledAlias[] {
  const out: CompiledAlias[] = [];
  for (const row of rows) {
    for (const alias of row.aliases) {
      const numeric = /^\d+$/.test(alias);
      const src = aliasSource(alias);
      // Not followed by another digit, letter-subsection or colon-section, so
      // "215" does not claim "215(a)(3)" and "10:5-5" does not claim "10:5-50".
      const tail = "(?![\\w:])";
      const re = numeric
        ? new RegExp(`${PREFIX}(${src})${tail}`, "gi")
        : new RegExp(`(?<![\\w:.])(${src})${tail}`, "gi");
      out.push({ row, re, len: alias.length });
    }
  }
  return out;
}

/** Split into sentences without breaking on "U.S.C." or "N.J.S.A." or "§ 825.307". */
export function statuteSentences(body: string): string[] {
  const masked = body
    // Dotted abbreviations (U.S.C., C.F.R., N.J.S.A.), final period included.
    .replace(/\b(?:[A-Z]\.){2,}/g, (m) => m.replace(/\./g, "\u0000"))
    .replace(/(\d)\.(\d)/g, "$1\u0001$2")
    .replace(/\b(Sec|Exec|Lab|Admin|No|Inc|Co|Esq|v)\./g, "$1\u0002");
  return masked
    .split(/(?<=[.!?])\s+|\n{1,}/)
    .map((s) => s.replace(/\u0000/g, ".").replace(/\u0001/g, ".").replace(/\u0002/g, ".").trim())
    .filter(Boolean);
}

/** Any "§ X" / "Section X" citation, for the unverified check. */
const ANY_CITATION = new RegExp(`${PREFIX}(\\d[\\w.:]*(?:[-\\s]?\\(?[\\w]{1,4}\\)?)*)`, "g");

/**
 * First term found at the START of a word. A term still matches as a prefix
 * ("waive" finds "waived", "averag" finds "averaging"), but never from inside
 * a word: "sue" must not fire on "pursue" or "issue", and "not" must not
 * clear a sentence because it says "notice".
 */
function containsAny(hay: string, terms: readonly string[]): string | null {
  for (const t of terms) {
    if (!t) continue;
    const src = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(?<![A-Za-z0-9])${src}`, "i").test(hay)) return t;
  }
  return null;
}

export function checkStatutes(body: string, rows: readonly StatuteRow[]): StatuteHit[] {
  if (!body?.trim() || rows.length === 0) return [];
  const compiled = compileTable(rows);
  const hits: StatuteHit[] = [];

  for (const sentence of statuteSentences(body)) {
    // Every alias occurrence, keeping the longest at each position so
    // "2611(4)(A)(i)" beats "2611(4)".
    type Occ = { start: number; end: number; rows: StatuteRow[]; len: number };
    const occs: Occ[] = [];
    for (const c of compiled) {
      c.re.lastIndex = 0;
      for (const m of sentence.matchAll(c.re)) {
        const text = m[1] ?? m[0];
        const start = (m.index ?? 0) + m[0].length - text.length;
        const end = start + text.length;
        const same = occs.find((o) => o.start === start && o.end === end);
        if (same) {
          if (!same.rows.includes(c.row)) same.rows.push(c.row);
        } else {
          occs.push({ start, end, rows: [c.row], len: end - start });
        }
      }
    }
    const kept = occs.filter(
      (o) => !occs.some((p) => p !== o && p.start <= o.start && p.end >= o.end && p.len > o.len),
    );

    // Which bodies of law the sentence names, to settle "215" (NYLL or FLSA?).
    const codes = (Object.keys(CODE_CONTEXT) as StatuteCode[]).filter((k) => CODE_CONTEXT[k].test(sentence));

    for (const o of kept) {
      let candidates = o.rows;
      if (candidates.length > 1) {
        const scoped = candidates.filter((r) => codes.includes(r.code));
        if (scoped.length === 1) candidates = scoped;
        else continue; // ambiguous: never guess which statute a bare number is
      } else if (codes.length > 0 && !codes.includes(candidates[0].code) && /^\d/.test(sentence.slice(o.start, o.end))) {
        // A bare number whose only row is in a DIFFERENT body of law than the
        // sentence names ("Section 120 of the Labor Law") is not that row.
        continue;
      }
      const row = candidates[0];
      const term = containsAny(sentence, row.mismatch);
      if (term && !containsAny(sentence, row.unless)) {
        hits.push({ kind: "mismatch", row, term, sentence, matched: sentence.slice(o.start, o.end) });
      }
    }

    // Unverified: a formal citation in a sentence that names a body of law,
    // which no row accounts for.
    if (codes.length > 0) {
      ANY_CITATION.lastIndex = 0;
      for (const m of sentence.matchAll(ANY_CITATION)) {
        const start = (m.index ?? 0) + m[0].length - m[1].length;
        const covered = kept.some((o) => o.start <= start + 1 && o.end >= start + 1);
        if (!covered) hits.push({ kind: "unverified", citation: m[0].trim(), sentence });
      }
    }
  }
  return hits;
}
