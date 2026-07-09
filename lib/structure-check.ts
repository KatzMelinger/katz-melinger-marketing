/**
 * Structure check — the backstop for section-scaffold enforcement.
 *
 * The generator is handed the full KM section scaffold up front
 * (renderStructureBlock). This verifies the FINISHED draft actually carries the
 * required structure: a minimum number of H2 body sections for the content type,
 * plus a set of must-have named anchors (FAQ, statute of limitations, CTA, etc.).
 *
 * It is deliberately keyword/role based, not exact-label matching. The model
 * personalizes template labels like "What Is This?" into "What Is Minimum Wage?",
 * so exact matching would false-flag a good draft. Kept lenient enough not to
 * block a well-structured draft, strict enough to catch one that skipped whole
 * sections. Pairs with renderStructureBlock() in lib/km-content-system.ts.
 */

import { parseMarkdownHeadings } from "@/lib/redraft-analyze";
import {
  getKmStructure,
  type KMContentType,
  type KMPracticeArea,
} from "@/lib/km-content-system";

export type StructureCheck = {
  contentType: KMContentType;
  /** Count of H2 ("## ") headings found in the draft. */
  h2Count: number;
  /** Minimum H2 sections expected for this content type. */
  minH2: number;
  /** Named sections that must appear as a heading but don't. */
  missing: string[];
  passed: boolean;
};

type Anchor = { key: string; label: string; re: RegExp };

// Role-based heading families. Matched against the draft's H2/H3 headings.
const FAQ_RE = /\b(faq|frequently asked|common questions)\b/i;
const CTA_RE =
  /\b(consultation|contact|get (help|started)|speak (with|to)|call (us|our)|reach out|next step|why (call|hire))\b/i;
const SOL_RE =
  /\b(statute of limitations|time limit|how long|deadline|filing window|enforcement window|time to (file|act)|limitations period|how much time)\b/i;
const WHYUS_RE = /\b(why (choose|work with|hire|katz melinger|our firm|us))\b/i;
const EVIDENCE_RE =
  /\b(evidence|documentation|documents|records|what to (document|preserve|keep|gather))\b/i;
const CONCLUSION_RE =
  /\b(conclusion|takeaway|bottom line|final thoughts|summary|what this means)\b/i;

const ANCHORS: Record<KMContentType, Anchor[]> = {
  practice_page: [
    { key: "evidence", label: "Evidence and documentation", re: EVIDENCE_RE },
    { key: "sol", label: "Statute of limitations / enforcement window (its own section)", re: SOL_RE },
    { key: "whyus", label: "Why Katz Melinger", re: WHYUS_RE },
    { key: "faq", label: "FAQ", re: FAQ_RE },
    { key: "cta", label: "Closing CTA / consultation", re: CTA_RE },
  ],
  blog_post: [
    { key: "sol", label: "How long they have to act (statute of limitations)", re: SOL_RE },
    { key: "faq", label: "FAQ", re: FAQ_RE },
    { key: "conclusion", label: "Conclusion", re: CONCLUSION_RE },
    { key: "cta", label: "CTA (links to pillar page)", re: CTA_RE },
  ],
  case_result: [
    { key: "faq", label: "FAQ", re: FAQ_RE },
    { key: "cta", label: "CTA", re: CTA_RE },
  ],
};

/**
 * Minimum H2 count = heading-bearing sections in the scaffold, minus a small
 * tolerance for structural variation. Practice pages have two non-H2 sections
 * (Page Setup planning + the H1/intro); blog and case result have one (the
 * intro/scenario/situation, which usually rides under the H1 with no heading).
 */
function minH2For(contentType: KMContentType, practiceArea: KMPracticeArea): number {
  const sections = getKmStructure(contentType, practiceArea);
  const nonH2 = contentType === "practice_page" ? 2 : 1;
  const expected = sections.length - nonH2;
  return Math.max(3, expected - 2);
}

export function checkStructure(
  body: string,
  contentType: KMContentType,
  practiceArea: KMPracticeArea,
): StructureCheck {
  const headings = parseMarkdownHeadings(body ?? "");
  const h2Count = headings.filter((h) => h.level === 2).length;
  const headingBlob = headings
    .filter((h) => h.level >= 2)
    .map((h) => h.text)
    .join(" \n ");
  const minH2 = minH2For(contentType, practiceArea);

  const missing: string[] = [];
  for (const a of ANCHORS[contentType]) {
    if (!a.re.test(headingBlob)) missing.push(a.label);
  }

  // When an FAQ heading exists, its questions must be H3 (### question ...?).
  const hasFaqHeading = FAQ_RE.test(headingBlob);
  const hasH3Question = headings.some(
    (h) => h.level >= 3 && /\?\s*$/.test(h.text.trim()),
  );
  if (hasFaqHeading && !hasH3Question) {
    missing.push("FAQ questions as H3 (### question) with direct answers");
  }

  const countShort = h2Count < minH2;
  if (countShort) {
    missing.push(`At least ${minH2} H2 sections (found ${h2Count})`);
  }

  return {
    contentType,
    h2Count,
    minH2,
    missing,
    passed: missing.length === 0,
  };
}
