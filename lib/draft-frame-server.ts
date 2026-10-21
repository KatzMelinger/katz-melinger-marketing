/**
 * The frame's server half (Oct 20 spec, Tasks A1 and A2): what the frame is
 * built from (Brand settings, the draft's reviewing attorney and clearance),
 * and the writes that keep every open draft in its frame.
 *
 *   frameDraft()            one draft: body -> metadata.content -> body
 *   reassembleOpenDrafts()  every open website draft, after a Brand change
 *   reviewAreaForDraft()    which attorney reviews it (unknown blocks Ready)
 */
import { getSupabaseAdmin } from "./supabase-server";
import { getOperatingBrief, type OperatingBrief } from "./social-operating-brief";
import { normalizePracticeArea } from "./audience-angle";
import { keywordProblem } from "./keyword-guard";
import {
  assembleDraft,
  isFramedFormat,
  readContent,
  splitDraft,
  type DraftContent,
  type FrameBrand,
  type FrameByline,
  type SplitResult,
} from "./draft-frame";
import type { ReviewArea } from "./legal-reviewers";
import { changeId, type FixChange } from "./legal-fix-log";

type Meta = Record<string, unknown>;

export type DraftForFrame = {
  id?: string;
  body: string;
  title: string | null;
  topic?: string | null;
  format: string | null;
  practice_area?: string | null;
  metadata: Meta | null;
};

/** metadata.review (Task A2): written when the reviewing attorney clears the draft. */
export type DraftReview = {
  attorney: string;
  bio_url: string | null;
  area: ReviewArea | null;
  cleared_at: string;
  cleared_by_user: string;
};

export function readReview(meta: Meta | null | undefined): DraftReview | null {
  const r = meta?.review as DraftReview | undefined;
  return r && typeof r === "object" && typeof r.attorney === "string" && typeof r.cleared_at === "string" ? r : null;
}

export function draftLanguage(meta: Meta | null | undefined): "en" | "es" {
  return String(meta?.language ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

export function frameBrandFrom(brief: OperatingBrief, language: "en" | "es"): FrameBrand {
  return {
    language,
    phone: brief.webPhone,
    offerPhrase: brief.offerPhrase,
    offerPhraseEs: brief.offerPhraseEs,
    spanishDisclaimerUrl: brief.spanishDisclaimerUrl,
  };
}

const JUDGMENT_ENFORCEMENT =
  /\b(?:judgment|judgement)\s+(?:enforc\w*|collect\w*|creditor)\b|\benforc\w*\s+(?:a\s+|the\s+|your\s+)?(?:judgment|judgement)\b|\brestraining\s+notice\b|\binformation\s+subpoena\b|\blevy\b|\bturnover\s+proceeding\b|\bdomesticat\w*/i;

/**
 * The draft's practice area from its pillar, then its practice_area column,
 * then its title and topic. Null when nothing says: such a draft cannot reach
 * Ready (Task A2), rather than defaulting to an attorney who never saw it.
 */
export function reviewAreaForDraft(d: Pick<DraftForFrame, "title" | "topic" | "practice_area" | "metadata">): ReviewArea | null {
  const meta = d.metadata ?? {};
  const kb = (meta.km_brief as Meta | undefined) ?? {};
  const sb = (meta.seo_brief as Meta | undefined) ?? {};
  const pillar = String(meta.pillar_id ?? kb.pillarId ?? sb.pillarId ?? "");
  const text = [pillar, d.title, d.topic].filter(Boolean).join(" ");
  if (/judgment|enforcement|domestica/i.test(pillar)) return "judgment_enforcement";
  const area = normalizePracticeArea(d.practice_area) ?? normalizePracticeArea(pillar) ?? normalizePracticeArea(text);
  if (area === "employment") return "employment";
  if (area === "collections") return JUDGMENT_ENFORCEMENT.test(text) ? "judgment_enforcement" : "commercial_collections";
  if (JUDGMENT_ENFORCEMENT.test(text) && !/employ/i.test(text)) return "judgment_enforcement";
  return null;
}

/** Pending until the attorney clears it; then the linked "Reviewed by" line. */
export function bylineForDraft(d: DraftForFrame, brief: OperatingBrief): FrameByline {
  const review = readReview(d.metadata);
  if (review) return { state: "reviewed", attorney: review.attorney, bioUrl: review.bio_url, clearedAt: review.cleared_at };
  const area = reviewAreaForDraft(d);
  return { state: "pending", attorney: area ? brief.reviewersByPractice[area].name : null };
}

/**
 * SEO values the body carried as notes ("Meta title: ...") move into
 * metadata when metadata has none; they never stay in the body.
 */
function seoFromNotes(meta: Meta, notes: SplitResult["seoNotes"]): Meta {
  const out: Meta = {};
  if (notes.metaTitle && !meta.metaTitle) out.metaTitle = notes.metaTitle;
  if (notes.metaDescription && !meta.metaDescription) out.metaDescription = notes.metaDescription;
  if (notes.slug && !meta.urlSlug && !meta.slug) out.urlSlug = notes.slug;
  if (notes.searchIntent && !meta.search_intent) out.search_intent = notes.searchIntent;
  if (notes.secondaryKeywords && !meta.secondary_keywords) {
    out.secondary_keywords = notes.secondaryKeywords.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  // A primary keyword from a note only fills an empty slot, and only if it is
  // a keyword (Task 15's guard), not a list or a task title.
  const first = notes.primaryKeyword?.split(/[,;]/)[0]?.trim();
  if (first && !meta.primaryKeyword && !keywordProblem(first)) out.primaryKeyword = first;
  return out;
}

/**
 * Schema from the article, into metadata, never the body (Task A1). FAQPage
 * only: Yoast already emits Article on every page, and a second Article fails
 * validation (lib/technical-fix-analyzer.ts). The reviewer is stored for the
 * WordPress side to add to Yoast's Article as reviewedBy (Tasks A2, A12).
 */
function schemaFor(content: DraftContent, review: DraftReview | null): Meta {
  const faq =
    content.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faq.map((f) => ({
            "@type": "Question",
            name: f.q.replace(/[*_`#]/g, "").trim(),
            acceptedAnswer: { "@type": "Answer", text: f.a.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim() },
          })),
        }
      : null;
  return {
    schema_jsonld: faq,
    article_reviewed_by: review ? { "@type": "Person", name: `${review.attorney}, Esq.`, url: review.bio_url } : null,
  };
}

export type FramedDraft = {
  body: string;
  metadata: Meta;
  content: DraftContent;
  removed: SplitResult["removed"];
};

/**
 * Put one draft in its frame: read the article out of the body (dropping any
 * frame element wherever it sits), store it as metadata.content, and write
 * the body from it. Not a website format: returned unchanged.
 *
 * `fromContent: true` reassembles from the stored content without re-reading
 * the body (a Brand change, a clearance): the article cannot change.
 */
export function frameDraftWith(
  d: DraftForFrame,
  brief: OperatingBrief,
  opts: { fromContent?: boolean } = {},
): FramedDraft | null {
  if (!isFramedFormat(d.format)) return null;
  const meta = { ...(d.metadata ?? {}) };
  const stored = readContent(meta);
  let content: DraftContent;
  let removed: SplitResult["removed"] = [];
  let extraMeta: Meta = {};
  if (opts.fromContent && stored) {
    content = stored;
  } else {
    const split = splitDraft(d.body ?? "", { title: d.title });
    content = split.content;
    removed = split.removed;
    extraMeta = seoFromNotes(meta, split.seoNotes);
  }
  const language = draftLanguage(meta);
  const byline = bylineForDraft(d, brief);
  const body = assembleDraft(content, frameBrandFrom(brief, language), { format: d.format, byline });
  return {
    body,
    content,
    removed,
    metadata: {
      ...meta,
      ...extraMeta,
      ...schemaFor(content, readReview(meta)),
      content,
      frame: { assembled_at: new Date().toISOString(), language, byline: byline.state },
    },
  };
}

export async function frameDraft(tenantId: string, d: DraftForFrame, opts: { fromContent?: boolean } = {}): Promise<FramedDraft | null> {
  if (!isFramedFormat(d.format)) return null;
  return frameDraftWith(d, await getOperatingBrief(tenantId), opts);
}

const REMOVED_LABEL: Record<SplitResult["removed"][number]["kind"], string> = {
  label: "label",
  byline: "byline",
  cta: "CTA",
  disclaimer: "disclaimer",
  results: "results line",
  seo_note: "SEO note",
  schema: "schema code",
  author_box: "author box",
  contact: "contact detail",
};

/**
 * The one "Changes made" entry for a draft's first framing (Task A5 wording:
 * "Rebuilt with the October 20 frame", listing what was removed). The whole
 * body is the change, so Undo puts the pre-frame version back.
 */
export function rebuildChange(before: string, after: string, removed: SplitResult["removed"]): FixChange {
  const counts = new Map<string, number>();
  for (const r of removed) counts.set(REMOVED_LABEL[r.kind], (counts.get(REMOVED_LABEL[r.kind]) ?? 0) + 1);
  const list = [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
  const notes = removed
    .filter((r) => r.kind === "seo_note" || r.kind === "contact" || r.kind === "author_box")
    .map((r) => `"${r.text.replace(/\s+/g, " ").slice(0, 80)}"`)
    .slice(0, 6)
    .join("; ");
  return {
    id: changeId(),
    where: "Top",
    from: before,
    to: after,
    reason:
      `Rebuilt with the October 20 frame: label, byline, CTA and disclaimer now come from Brand settings.` +
      (list ? ` Removed from the body: ${list}.` : "") +
      (notes ? ` Including ${notes}.` : ""),
    source: "required element",
    source_ref: "oct20_frame",
    at: new Date().toISOString(),
  };
}

const OPEN_EXCLUDED = "(archived,published)";

/**
 * Re-assemble every open website draft from its stored content (Task A1:
 * "changing the CTA in Brand settings changes it in every open draft without
 * a rescan"). A draft with no stored content yet is split from its body
 * first. Only the body and metadata.content/frame are written: findings,
 * sign-offs and the Changes made log are untouched, because the article did
 * not change.
 */
export async function reassembleOpenDrafts(tenantId: string): Promise<{ checked: number; changed: number; errors: string[] }> {
  const sb = getSupabaseAdmin();
  const brief = await getOperatingBrief(tenantId);
  const { data, error } = await sb
    .from("content_drafts")
    .select("id, body, title, topic, format, practice_area, metadata")
    .eq("tenant_id", tenantId)
    .not("status", "in", OPEN_EXCLUDED)
    .range(0, 1999);
  if (error) return { checked: 0, changed: 0, errors: [error.message] };
  let changed = 0;
  const errors: string[] = [];
  for (const d of data ?? []) {
    const framed = frameDraftWith(d as DraftForFrame, brief, { fromContent: true });
    if (!framed || framed.body === d.body) continue;
    const { error: e } = await sb
      .from("content_drafts")
      .update({ body: framed.body, metadata: framed.metadata, updated_at: new Date().toISOString() })
      .eq("id", d.id)
      .eq("tenant_id", tenantId);
    if (e) errors.push(`${d.id}: ${e.message}`);
    else changed++;
  }
  return { checked: data?.length ?? 0, changed, errors };
}

/** Brand settings keys that feed the frame: a change to one re-assembles open drafts. */
export const FRAME_SETTING_KEYS = new Set([
  "webPhone",
  "socialOfferPhrase",
  "socialOfferPhraseEs",
  "spanishDisclaimerUrl",
  "reviewersByPractice",
]);
