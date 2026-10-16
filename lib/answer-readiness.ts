/**
 * Answer readiness (Oct 6 spec, Task 19): what an AI answer engine needs to
 * quote a page. Warnings in Run analysis, never blockers:
 *   1. a direct answer of 60 words or fewer right under the H1
 *   2. an FAQ section
 *   3. a primary-source citation for every legal claim with a number or deadline
 *   4. the byline linked to the author's bio page
 * Pure.
 */
import { AUTHORS } from "./authors";
import { legalScopeKinds } from "./legal-scope";

const PRIMARY_SOURCE =
  /\]\(https?:\/\/[^)]*(?:\.gov\b|nysenate\.gov|law\.cornell\.edu|njleg\.state\.nj\.us|codes\.findlaw|casetext|courtlistener|nycourts\.gov|njcourts\.gov|ecfr\.gov|uscode\.house\.gov)[^)]*\)/i;

/** Lines under the H1 that are not the answer: label, byline, date, image, blank. */
const PREAMBLE = /^\s*(?:[*_]*\s*attorney advertising\s*[*_]*|[*_]*\s*by\s+\S.*|[*_]*\s*(?:last\s+)?(?:updated|published|reviewed)\b.*|!\[.*|---+|)\s*$/i;

const words = (s: string) => s.replace(/[*_#>[\]()]/g, " ").trim().split(/\s+/).filter(Boolean).length;

export function answerReadiness(body: string): string[] {
  const out: string[] = [];
  const lines = (body ?? "").split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));

  // 1. Direct answer.
  if (h1 >= 0) {
    let i = h1 + 1;
    while (i < lines.length && PREAMBLE.test(lines[i])) i++;
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i])) para.push(lines[i++]);
    const n = words(para.join(" "));
    if (n === 0) out.push("Answer readiness: no answer paragraph right under the H1. Open with a direct answer of 60 words or fewer.");
    else if (n > 60) out.push(`Answer readiness: the paragraph under the H1 is ${n} words. Open with a direct answer of 60 words or fewer.`);
  }

  // 2. FAQ section.
  if (!lines.some((l) => /^#{2,4}\s+.*\b(faq|frequently asked questions)\b/i.test(l))) {
    out.push("Answer readiness: no FAQ section. Add one with the questions people ask about this topic.");
  }

  // 3. A primary source for each legal claim with a number or deadline.
  const paragraphs = (body ?? "").split(/\n\s*\n/);
  const unsourced: string[] = [];
  for (const p of paragraphs) {
    if (/^#/.test(p.trim()) || PRIMARY_SOURCE.test(p)) continue;
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      const kinds = legalScopeKinds(s);
      if (kinds.includes("figure") && !kinds.includes("citation")) unsourced.push(s.trim());
    }
  }
  if (unsourced.length) {
    out.push(
      `Answer readiness: ${unsourced.length} legal claim${unsourced.length === 1 ? "" : "s"} with a number or deadline cite no primary source (statute, regulation or agency link), e.g. "${unsourced[0].slice(0, 120)}"`,
    );
  }

  // 4. Byline linked to the bio page.
  const byline = lines.find((l) => /^\s*[*_]*\s*By\s+\[?[A-Z]/.test(l));
  if (byline && !AUTHORS.some((a) => a.bioPageUrl && byline.includes(a.bioPageUrl))) {
    out.push("Answer readiness: the byline does not link to the author's bio page (bar admissions live there). Fix known errors links it.");
  }
  return out;
}
