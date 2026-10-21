/**
 * One definition of "Ready for Diana" (Oct 20 spec, Task A4).
 *
 * isReady() is used by the review screen's checklist, the Production Board's
 * "Ready for Diana" column and the Approve route, so the three can never
 * disagree about what stands between a draft and publishing. A draft is
 * ready only when every item passes; each failing item names the exact
 * reason. Scores (SEO, AEO, CASH, brand voice, readability) are information
 * only and are not here.
 *
 *   1 Frame          the body is exactly assembleDraft(content) (Task A1)
 *   2 Keyword        chosen through keyword selection, with volume; passes the guard
 *   3 Legal facts    no claim waiting on an attorney decision (no knowledge base entry)
 *   4 Attorney       the reviewing attorney has cleared it (Task A2)
 *   5 Checks         no open critical finding on the current text
 *   6 Fee rule       no fee language; the offer appears only in the CTA
 *   7 Links          at least three internal links, none empty
 *   8 Style          no em or en dashes, no emojis
 *   9 Sources, SEO   source check and quality checks (Part 4, not active yet)
 *
 * Pure: the caller loads the open findings (lib/draft-readiness-server.ts).
 */
import { assembleDraft, frameCtaLine, isFramedFormat, readContent } from "./draft-frame";
import { bylineForDraft, draftLanguage, frameBrandFrom, readReview, reviewAreaForDraft, type DraftForFrame } from "./draft-frame-server";
import { findFeeLanguage } from "./fee-language";
import { keywordProblem } from "./keyword-guard";
import { internalLinks, MIN_INTERNAL_LINKS } from "./required-elements";
import type { OperatingBrief } from "./social-operating-brief";
import { REVIEW_AREA_LABEL } from "./legal-reviewers";

export type ReadinessKey = "frame" | "keyword" | "legal_facts" | "clearance" | "checks" | "fee" | "links" | "style" | "sources_quality";

export type ReadinessItem = {
  key: ReadinessKey;
  label: string;
  pass: boolean;
  /** Why it fails, one line each; empty when it passes. */
  reasons: string[];
  /** Shown, never blocking (item 9 until Part 4 is built). */
  pending?: boolean;
  /** Information that does not block ("Please confirm" items). */
  notes?: string[];
};

export type Readiness = { applicable: boolean; ready: boolean; items: ReadinessItem[]; failing: string[] };

export type ReadinessFinding = {
  severity: string;
  source: string;
  ruleId: string | null;
  title: string;
  excerpt: string | null;
};

export const READINESS_LABEL: Record<ReadinessKey, string> = {
  frame: "Frame: label, byline, CTA and disclaimer from Brand settings",
  keyword: "Keyword chosen with search volume",
  legal_facts: "Legal facts: no claim waiting on an attorney decision",
  clearance: "Attorney clearance",
  checks: "No open critical finding",
  fee: "Fee rule",
  links: `At least ${MIN_INTERNAL_LINKS} internal links`,
  style: "Style: no em or en dashes, no emojis",
  sources_quality: "Sources and SEO/AEO checks",
};

const DASH = /[–—]/;
const EMOJI = /\p{Extended_Pictographic}/u;
const EMPTY_LINK = /\[\s*\]\([^)]*\)|\[[^\]\n]+\]\(\s*\)/;

function primaryKeyword(meta: Record<string, unknown>): string | null {
  const kb = (meta.km_brief as Record<string, unknown> | undefined) ?? {};
  const sb = (meta.seo_brief as Record<string, unknown> | undefined) ?? {};
  const sel = (meta.keyword_selection as { chosen?: { keyword?: unknown } } | undefined)?.chosen?.keyword;
  for (const k of [meta.primaryKeyword, kb.primaryKeyword, sb.primaryKeyword, sel]) {
    if (typeof k === "string" && k.trim()) return k.trim();
  }
  return null;
}

function quote(s: string | null, n = 110): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function isReady(d: DraftForFrame, brief: OperatingBrief, openFindings: ReadinessFinding[]): Readiness {
  if (!isFramedFormat(d.format)) return { applicable: false, ready: false, items: [], failing: [] };
  const meta = d.metadata ?? {};
  const body = d.body ?? "";
  const items: ReadinessItem[] = [];
  const item = (key: ReadinessKey, reasons: string[], extra: Partial<ReadinessItem> = {}) =>
    items.push({ key, label: READINESS_LABEL[key], pass: reasons.length === 0, reasons, ...extra });

  // 1. Frame.
  const content = readContent(meta);
  const language = draftLanguage(meta);
  const brand = frameBrandFrom(brief, language);
  if (!content) {
    item("frame", ["Not in the October 20 frame yet. Press Rescan on the Rules page to rebuild it."]);
  } else {
    const expected = assembleDraft(content, brand, { format: d.format, byline: bylineForDraft(d, brief) });
    item("frame", expected === body ? [] : ["The label, byline, CTA or disclaimer differs from Brand settings. Saving the draft rebuilds the frame."]);
  }

  // 2. Keyword.
  const kw = primaryKeyword(meta);
  const sel = meta.keyword_selection as { status?: string; chosen?: { volume?: number | null } | null } | undefined;
  const kwReasons: string[] = [];
  if (!kw) kwReasons.push("No primary keyword. Choose one in Keyword selection.");
  else {
    const problem = keywordProblem(kw);
    if (problem) kwReasons.push(`"${quote(kw, 60)}" is not a keyword (${problem}). Choose one in Keyword selection.`);
    else if (sel?.status !== "selected" || sel.chosen?.volume == null) {
      kwReasons.push(`"${kw}" was not chosen through Keyword selection with DataForSEO volume.`);
    }
  }
  item("keyword", kwReasons);

  // 3. Legal facts: a figure or citation no rule checks is a decision for the
  // practice area attorney (Part 2 item 3). An unanchored duty statement stays
  // "Please confirm", listed but not blocking (Kenneth, 2026-10-12).
  const area = reviewAreaForDraft(d);
  const attorney = area ? brief.reviewersByPractice[area].name : null;
  const decisions = openFindings.filter((f) => f.ruleId === "no_rule");
  const confirms = openFindings.filter((f) => f.ruleId === "no_rule_confirm");
  item(
    "legal_facts",
    decisions.slice(0, 5).map((f) => `Needs a decision from ${attorney ?? "the reviewing attorney"}: "${quote(f.excerpt)}"`).concat(
      decisions.length > 5 ? [`and ${decisions.length - 5} more`] : [],
    ),
    confirms.length ? { notes: confirms.slice(0, 3).map((f) => `Please confirm: "${quote(f.excerpt)}"`) } : {},
  );

  // 4. Attorney clearance (Task A2).
  const review = readReview(meta);
  item(
    "clearance",
    review
      ? []
      : area
        ? [`Waiting for ${attorney} (${REVIEW_AREA_LABEL[area]}) to clear it in Legal Review.`]
        : ["The practice area is not set, so no attorney can be assigned. Set the pillar or practice area."],
  );

  // 5. No open critical finding on the current text.
  const critical = openFindings.filter((f) => f.severity === "critical");
  item(
    "checks",
    critical.slice(0, 5).map((f) => `${f.title}${f.excerpt ? `: "${quote(f.excerpt, 80)}"` : ""}`).concat(
      critical.length > 5 ? [`and ${critical.length - 5} more`] : [],
    ),
  );

  // 6. Fee rule; the offer only in the CTA (Part 2 item 2).
  const cta = frameCtaLine(brand);
  const prose = body
    .split("\n")
    .filter((l) => l.trim() !== cta)
    .join("\n");
  const fee = findFeeLanguage(prose);
  const offer = language === "es" ? brief.offerPhraseEs : brief.offerPhrase;
  const feeReasons = fee.slice(0, 3).map((h) => `${h.rule}: "${quote(h.sentence, 90)}"`);
  if (offer && prose.toLowerCase().includes(offer.toLowerCase())) feeReasons.push(`"${offer}" appears outside the CTA.`);
  item("fee", feeReasons);

  // 7. Links, in the article only: the byline's bio link and the disclaimer
  // link are frame, not internal linking.
  const article = content
    ? [content.direct_answer, content.intro, ...content.sections.map((s) => s.body), ...content.faq.map((f) => f.a), content.case_result.text].join("\n")
    : body;
  const links = internalLinks(article);
  const linkReasons: string[] = [];
  if (links.length < MIN_INTERNAL_LINKS) linkReasons.push(`${links.length} internal link${links.length === 1 ? "" : "s"} to katzmelinger.com; ${MIN_INTERNAL_LINKS} are required.`);
  const empty = body.match(EMPTY_LINK);
  if (empty) linkReasons.push(`Empty link: ${empty[0].slice(0, 60)}`);
  item("links", linkReasons);

  // 8. Style.
  const styleReasons: string[] = [];
  const dash = body.match(DASH);
  if (dash) styleReasons.push(`An ${dash[0] === "—" ? "em" : "en"} dash: "${quote(body.slice(Math.max(0, (dash.index ?? 0) - 40), (dash.index ?? 0) + 40), 90)}"`);
  const emoji = body.match(EMOJI);
  if (emoji) styleReasons.push(`An emoji: ${emoji[0]}`);
  item("style", styleReasons);

  // 9. Part 4 (Tasks A7, A8): shown, not active yet.
  items.push({
    key: "sources_quality",
    label: READINESS_LABEL.sources_quality,
    pass: true,
    reasons: [],
    pending: true,
    notes: ["Not active yet: the source check (A7) and SEO/AEO checks (A8) come with Part 4."],
  });

  const failing = items.filter((i) => !i.pass).map((i) => i.key);
  return { applicable: true, ready: failing.length === 0, items, failing };
}
