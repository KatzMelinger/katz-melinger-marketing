/**
 * Redraft flow — stages 1 & 2: Content Type Detection and Gap Audit.
 *
 * Stage 1 detects what a published page IS (blog post / practice page / case
 * result) so the redraft follows the right structure. Deterministic-first from
 * the URL, heading outline, and text cues; only ambiguous pages fall back to a
 * cheap Claude classification.
 *
 * Stage 2 audits the page against a per-type section checklist plus the target
 * keywords, and returns the concrete GAPS. The redraft then ADDS those gaps
 * without rewriting what already works (the additive behavior 1.5 specifies).
 */

import { getAnthropic, CONTENT_SHORT_FORM_MODEL, extractJSON } from "./anthropic";
import type { KMContentType } from "./km-content-system";
import type { PageOutline } from "./page-optimizer";

export type DetectedType = {
  contentType: KMContentType;
  /** how it was decided — "rules" (deterministic) or "claude" (fallback). */
  source: "rules" | "claude";
};

export type GapReport = {
  contentType: KMContentType;
  detectedBy: "rules" | "claude";
  /** Expected sections for this type that the page is missing. */
  missingSections: string[];
  /** Target keywords not present in the live copy. */
  missingKeywords: string[];
  /** Other advisory findings (thin content, no CTA, etc.). */
  notes: string[];
};

// ---------- Stage 1: content-type detection --------------------------------

const URL_HINTS: [RegExp, KMContentType][] = [
  [/\/(case-results?|results?|verdicts?|settlements?)(\/|$)/i, "case_result"],
  [/\/(practice-areas?|services?|attorneys?|what-we-do)(\/|$)/i, "practice_page"],
  [/\/(blog|news|articles?|insights?|faq|guides?)(\/|$)/i, "blog_post"],
];

function ruleScores(text: string, headings: { text: string }[], url: string): Record<KMContentType, number> {
  const t = text.toLowerCase();
  const h = headings.map((x) => x.text.toLowerCase()).join(" | ");
  const s: Record<KMContentType, number> = { blog_post: 0, practice_page: 0, case_result: 0 };

  for (const [re, type] of URL_HINTS) if (re.test(url)) s[type] += 3;

  // case_result cues: money recovered, verdicts, outcome language.
  if (/\$\s?\d/.test(text)) s.case_result += 2;
  if (/\b(verdict|settlement|recovered|awarded|obtained|jury|judgment in favor|prevailed)\b/i.test(t)) s.case_result += 2;
  if (/\b(the (client|plaintiff|result)|our client (recovered|received|won))\b/i.test(t)) s.case_result += 1;

  // practice_page cues: service framing, evergreen "we represent/handle".
  if (/\b(we (represent|handle|assist|help) (clients|employees|employers|businesses))\b/i.test(t)) s.practice_page += 2;
  if (/\b(our (attorneys|firm|team) (can help|represent|handle))\b/i.test(t)) s.practice_page += 1;
  if (/\b(practice area|our services|areas of practice)\b/i.test(t)) s.practice_page += 2;

  // blog cues: informational framing, questions, how-to.
  if (/\b(how to|what is|what to do|understanding|guide to|explained|frequently asked)\b/i.test(t)) s.blog_post += 2;
  if (/\?/.test(h)) s.blog_post += 1;
  if (/\b(posted on|published|min read|by [A-Z][a-z]+ [A-Z][a-z]+)\b/.test(text)) s.blog_post += 1;

  return s;
}

async function claudeClassify(text: string, url: string): Promise<KMContentType> {
  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content:
            `Classify this law-firm web page as exactly one of: "blog_post" (informational article/guide/FAQ), ` +
            `"practice_page" (an evergreen service/practice-area page), or "case_result" (a specific case outcome). ` +
            `URL: ${url}\n\nContent (excerpt):\n"""${text.slice(0, 2500)}"""\n\n` +
            `Return JSON only: { "contentType": "blog_post" | "practice_page" | "case_result" }`,
        },
      ],
    });
    const t = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{ contentType?: string }>(t);
    const ct = parsed?.contentType;
    if (ct === "blog_post" || ct === "practice_page" || ct === "case_result") return ct;
  } catch {
    /* fall through */
  }
  return "blog_post"; // firm leans blog; safest default
}

/**
 * Detect a page's content type. Deterministic when the signals are clear (a
 * confident winner with a margin); Claude fallback only when ambiguous.
 */
export async function detectContentType(outline: PageOutline, url: string): Promise<DetectedType> {
  const scores = ruleScores(outline.text, outline.headings, url);
  const ranked = (Object.entries(scores) as [KMContentType, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  // Confident when the top score is meaningful and clears the runner-up.
  if (top[1] >= 3 && top[1] - second[1] >= 2) {
    return { contentType: top[0], source: "rules" };
  }
  return { contentType: await claudeClassify(outline.text, url), source: "claude" };
}

// ---------- Stage 2: gap audit ---------------------------------------------

type SectionCheck = { label: string; present: (o: PageOutline) => boolean };

const headingMatches = (o: PageOutline, re: RegExp) => o.headings.some((h) => re.test(h.text));
const textMatches = (o: PageOutline, re: RegExp) => re.test(o.text);
const hasFaq = (o: PageOutline) =>
  headingMatches(o, /\b(faq|frequently asked|common questions)\b/i) ||
  o.headings.filter((h) => /\?$/.test(h.text.trim())).length >= 2;
const hasCta = (o: PageOutline) =>
  textMatches(o, /\b(free consultation|schedule a|contact us|call us|get in touch|speak (with|to) (an|our)|request a consultation)\b/i) ||
  /\b\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4}\b/.test(o.text);
const bodySectionCount = (o: PageOutline) => o.headings.filter((h) => h.level === 2).length;

const CHECKS: Record<KMContentType, SectionCheck[]> = {
  blog_post: [
    { label: "A clear opening/introduction", present: (o) => o.text.length > 200 },
    { label: "At least 3 body sections (H2 headings)", present: (o) => bodySectionCount(o) >= 3 },
    { label: "An FAQ section", present: hasFaq },
    { label: "A clear call-to-action / next step", present: hasCta },
  ],
  practice_page: [
    { label: "An overview of the service", present: (o) => o.text.length > 200 },
    { label: "A 'how we help / what we do' section", present: (o) => headingMatches(o, /\b(how we|what we|our (approach|process|services)|why (choose|work with))\b/i) },
    { label: "An FAQ section", present: hasFaq },
    { label: "A consultation / contact CTA", present: hasCta },
  ],
  case_result: [
    { label: "The situation / challenge", present: (o) => headingMatches(o, /\b(situation|challenge|background|the (case|matter|problem))\b/i) || o.text.length > 200 },
    { label: "What we did / our approach", present: (o) => headingMatches(o, /\b(what we did|our (approach|strategy)|how we)\b/i) },
    { label: "The outcome / result", present: (o) => headingMatches(o, /\b(outcome|result|resolution|verdict|settlement)\b/i) || /\$\s?\d/.test(o.text) },
    { label: "A results-may-vary disclaimer", present: (o) => textMatches(o, /\b(results? may vary|no guarantee|prior results do not|each case is different)\b/i) },
    { label: "A call-to-action", present: hasCta },
  ],
};

/**
 * Audit a page against the section checklist for its content type, plus the
 * target keywords. Returns the concrete gaps for the redraft to ADD.
 */
export function auditGaps(
  outline: PageOutline,
  detected: DetectedType,
  keywords: string[],
): GapReport {
  const checks = CHECKS[detected.contentType];
  const missingSections = checks.filter((c) => !c.present(outline)).map((c) => c.label);

  const haystack = outline.text.toLowerCase();
  const missingKeywords = keywords.filter((k) => k.trim() && !haystack.includes(k.toLowerCase().trim()));

  const notes: string[] = [];
  const words = outline.text.trim().split(/\s+/).filter(Boolean).length;
  const thinThreshold = detected.contentType === "practice_page" ? 250 : 400;
  if (words < thinThreshold) notes.push(`Thin content (~${words} words) — expand the substantive sections.`);
  if (outline.headings.length === 0) notes.push("No headings detected — add scannable H2/H3 structure.");

  return {
    contentType: detected.contentType,
    detectedBy: detected.source,
    missingSections,
    missingKeywords,
    notes,
  };
}

/** Render the gap report as a prompt block instructing an ADDITIVE redraft. */
export function gapReportPromptBlock(report: GapReport): string {
  const lines: string[] = [
    `DETECTED CONTENT TYPE: ${report.contentType.replace("_", " ")} (${report.detectedBy}).`,
    `This is an ADDITIVE update. Preserve the accurate, on-topic content that already works — do NOT rewrite sections that are fine. Focus your changes on filling these specific gaps:`,
  ];
  if (report.missingSections.length) lines.push(`- Missing sections to ADD: ${report.missingSections.join("; ")}.`);
  if (report.missingKeywords.length) lines.push(`- Target keywords not yet present — work these in naturally where they fit: ${report.missingKeywords.join(", ")}.`);
  if (report.notes.length) lines.push(`- Also: ${report.notes.join(" ")}`);
  if (!report.missingSections.length && !report.missingKeywords.length && !report.notes.length) {
    lines.push("- No structural gaps found. Make only light voice/clarity improvements; preserve the substance.");
  }
  return lines.join("\n");
}

// ---------- Headings: preserve strong ones, improve weak ones --------------

/**
 * Show the page's CURRENT heading outline and instruct purposeful heading
 * changes: keep headings that already work verbatim, only rewrite one when it
 * clearly improves SEO (H1 should carry the primary keyword; vague headings made
 * specific), and add new headings only for the gaps. Without this the generator
 * sees only stripped text and rebuilds headings blind.
 */
export function headingGuidanceBlock(outline: PageOutline, primaryKeyword: string): string {
  const kw = primaryKeyword.trim();
  if (!outline.headings.length) {
    return `CURRENT HEADINGS: none detected. Add a clear H1${kw ? ` that includes "${kw}"` : ""} and scannable H2/H3 section headings.`;
  }
  const list = outline.headings
    .map((h) => `${"#".repeat(Math.min(Math.max(h.level, 1), 3))} ${h.text}`)
    .join("\n");
  return `CURRENT HEADINGS — the page's existing structure. Preserve it:
${list}

HEADING RULES:
- Reuse each existing heading's EXACT text when it is already clear and relevant. Do NOT reword a heading that already works.
- Only change a heading when it measurably improves SEO: the H1 should contain the primary keyword${kw ? ` ("${kw}")` : ""}; replace vague headings (e.g. "Overview", "Introduction", "More Information") with specific, descriptive ones.
- Keep the existing sections and their order. Add NEW headings ONLY for the missing sections listed above.`;
}

/** Extract Markdown ATX headings (#, ##, ###…) from generated content. */
export function parseMarkdownHeadings(md: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  for (const line of (md ?? "").split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/#+\s*$/, "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

export type HeadingChangeSummary = {
  before: number;
  after: number;
  /** Original headings whose text still appears in the redraft. */
  kept: number;
  h1Before: string | null;
  h1After: string | null;
  h1Changed: boolean;
  /** New section headings (H2+) present after but not before. Excludes the H1. */
  added: string[];
};

const normHeading = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Compare the original page's headings against the redraft's headings. */
export function summarizeHeadingChanges(
  before: { level: number; text: string }[],
  after: { level: number; text: string }[],
): HeadingChangeSummary {
  const beforeSet = new Set(before.map((h) => normHeading(h.text)));
  const afterSet = new Set(after.map((h) => normHeading(h.text)));
  // Added = new H2+ sections. The H1 is reported separately (h1Changed) so a
  // reworded H1 isn't double-counted as an "added" heading.
  const added = after
    .filter((h) => h.level >= 2 && !beforeSet.has(normHeading(h.text)))
    .map((h) => h.text);
  const kept = before.filter((h) => afterSet.has(normHeading(h.text))).length;
  const h1Before = before.find((h) => h.level === 1)?.text ?? null;
  const h1After = after.find((h) => h.level === 1)?.text ?? null;
  return {
    before: before.length,
    after: after.length,
    kept,
    h1Before,
    h1After,
    h1Changed: !!h1Before && !!h1After && normHeading(h1Before) !== normHeading(h1After),
    added,
  };
}
