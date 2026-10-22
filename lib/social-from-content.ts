/**
 * Social and video built from published content (Oct 20 spec, Task A16).
 *
 * 1. Repurposing starts only from a published page or a Ready draft, so a
 *    post inherits claims that were already verified (repurposeSourceProblem).
 * 2. A post's legal claims that are not in its source blog's verified claims
 *    go through the source check (newClaimsCheck), cached on the post by
 *    claim, so approving and scheduling do not pay twice.
 * 3. Every video carries "Attorney Advertising. AI-Generated Performer" on
 *    screen and in the caption, with the full disclaimer link, and the
 *    results line whenever a result is mentioned (Kenneth, 2026-10-20; New
 *    York General Business Law section 396-b). A disclosure only in a comment
 *    does not count, so it is checked in the caption itself.
 */
import { extractSourceClaims, readSourceCheck, type SourceCheckEntry } from "./source-check";
import { getSupabaseAdmin } from "./supabase-server";

/** Kenneth's wording (2026-10-20), on screen and in the caption. */
export const AI_PERFORMER_DISCLOSURE = "Attorney Advertising. AI-Generated Performer";
export const VIDEO_RESULTS_LINE = "Prior results do not guarantee a similar outcome.";

const VIDEO_FORMATS = new Set(["video", "video_short", "video_long", "reel", "short", "tiktok", "youtube_short"]);
export function isVideoFormat(format: string | null | undefined): boolean {
  return !!format && VIDEO_FORMATS.has(format.toLowerCase());
}

/** The caption talks about a result the firm obtained. */
export function mentionsResult(text: string): boolean {
  return /\b(?:we|our (?:firm|client|team)|the firm|katz melinger)\s+(?:recovered|secured|obtained|won|settled)\b|\b(?:settlement|verdict|judgment|award) of \$\s?\d|\brecovered \$\s?\d/i.test(text);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.]+/g, " ").trim();

/** What a video caption is missing. */
export function videoDisclosureProblems(caption: string, disclaimerUrl: string): string[] {
  const out: string[] = [];
  if (!norm(caption).includes(norm(AI_PERFORMER_DISCLOSURE))) out.push(`Video caption is missing "${AI_PERFORMER_DISCLOSURE}" (NY GBL 396-b; a comment does not count).`);
  const path = disclaimerUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  if (path && !caption.includes(path)) out.push(`Video caption is missing the full disclaimer link (${disclaimerUrl}).`);
  if (mentionsResult(caption) && !norm(caption).includes(norm(VIDEO_RESULTS_LINE))) out.push(`Video caption mentions a result without "${VIDEO_RESULTS_LINE}"`);
  return out;
}

/** Add whatever a video caption is missing, at the end. */
export function ensureVideoDisclosure(caption: string, disclaimerUrl: string): string {
  const add: string[] = [];
  if (!norm(caption).includes(norm(AI_PERFORMER_DISCLOSURE))) add.push(`${AI_PERFORMER_DISCLOSURE}.`);
  if (mentionsResult(caption) && !norm(caption).includes(norm(VIDEO_RESULTS_LINE))) add.push(VIDEO_RESULTS_LINE);
  const path = disclaimerUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  if (path && !caption.includes(path)) add.push(`Disclaimer: ${disclaimerUrl}`);
  return add.length ? `${caption.trimEnd()}\n\n${add.join("\n")}` : caption;
}

/* ------------------------------------------------------------------ */
/* Where repurposing may start                                         */
/* ------------------------------------------------------------------ */

export function isFirmUrl(url: string, firmHost = "katzmelinger.com"): boolean {
  try {
    const h = new URL(url).host.replace(/^www\./, "").toLowerCase();
    return h === firmHost || h.endsWith(`.${firmHost}`);
  } catch {
    return false;
  }
}

/**
 * Null when the source may be repurposed: a published or Ready draft, or a
 * live page on the firm's site. Pasted text alone is not a source.
 */
export async function repurposeSourceProblem(args: {
  tenantId: string;
  sourceDraftId: string | null;
  url: string | null;
  isReady: (draft: Record<string, unknown>) => Promise<boolean>;
}): Promise<string | null> {
  // A live page on the firm's site is published content, whatever state its draft is in.
  if (args.url && isFirmUrl(args.url)) return null;
  if (args.sourceDraftId) {
    const { data } = await getSupabaseAdmin()
      .from("content_drafts")
      .select("id, status, title, topic, body, format, practice_area, metadata, seo_brief")
      .eq("tenant_id", args.tenantId)
      .eq("id", args.sourceDraftId)
      .maybeSingle();
    if (!data) return "The source draft was not found.";
    if (data.status === "published") return null;
    if (await args.isReady(data as Record<string, unknown>)) return null;
    return "Repurposing starts from a published blog or one that is Ready for Diana. Finish this draft first.";
  }
  if (args.url && isFirmUrl(args.url)) return null;
  return "Repurposing starts from a published katzmelinger.com page or a Ready draft, so every post inherits verified claims.";
}

/* ------------------------------------------------------------------ */
/* New claims in a post                                                */
/* ------------------------------------------------------------------ */

const figures = (s: string) => (s.match(/\$?\d[\d,.]*/g) ?? []).map((f) => f.replace(/[,.]$/, "")).sort().join("|");
const words = (s: string) => new Set(s.toLowerCase().match(/[a-záéíóúñ]{4,}/g) ?? []);

/** A post sentence states the same claim as one the blog verified: same figures, most words shared. */
export function sameClaim(post: string, verified: string): boolean {
  if (figures(post) !== figures(verified)) return false;
  const a = words(post);
  const b = words(verified);
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / Math.max(1, Math.min(a.size, b.size)) >= 0.5;
}

export type PostClaim = { sentence: string; status: "inherited" | "supported" | "answered" | "contradicted" | "not_found" | "no_entry"; reason: string; source_url: string | null };

/** Split a post's claims into inherited ones and new ones. */
export function splitPostClaims(content: string, verified: SourceCheckEntry[]) {
  const ok = verified.filter((e) => e.verdict === "supported" || e.verdict === "answered");
  const inherited: PostClaim[] = [];
  const fresh: { sentence: string; type: ReturnType<typeof extractSourceClaims>[number]["type"] }[] = [];
  for (const c of extractSourceClaims(content)) {
    const hit = ok.find((e) => sameClaim(c.sentence, e.sentence));
    if (hit) inherited.push({ sentence: c.sentence, status: "inherited", reason: `From the source blog: "${hit.sentence}"`, source_url: hit.source_url });
    else fresh.push(c);
  }
  return { inherited, fresh };
}

/**
 * Reasons to hold the post: a new claim the source contradicts, or one no
 * source settles. Results are kept on the post (metadata.social_claims).
 */
export async function newClaimsCheck(args: { tenantId: string; content: string; sourceBlogId: string | null; draftId: string | null }): Promise<string[]> {
  const sb = getSupabaseAdmin();
  let verified: SourceCheckEntry[] = [];
  if (args.sourceBlogId) {
    const { data } = await sb.from("content_drafts").select("metadata").eq("tenant_id", args.tenantId).eq("id", args.sourceBlogId).maybeSingle();
    verified = readSourceCheck((data?.metadata as Record<string, unknown> | null) ?? {})?.entries ?? [];
  }
  const { inherited, fresh } = splitPostClaims(args.content, verified);
  if (!fresh.length && !args.draftId) return [];

  let cache: PostClaim[] = [];
  let meta: Record<string, unknown> = {};
  if (args.draftId) {
    const { data } = await sb.from("content_drafts").select("metadata").eq("tenant_id", args.tenantId).eq("id", args.draftId).maybeSingle();
    meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    cache = Array.isArray(meta.social_claims) ? (meta.social_claims as PostClaim[]) : [];
  }
  const known = new Map(cache.filter((c) => c.status !== "inherited").map((c) => [c.sentence, c]));
  const todo = fresh.filter((c) => !known.has(c.sentence));
  if (todo.length) {
    const { checkClaims, loadSourceCheckInputs } = await import("./source-check-server");
    const entries = await checkClaims(args.tenantId, todo, await loadSourceCheckInputs(args.tenantId), args.draftId);
    for (const e of entries) known.set(e.sentence, { sentence: e.sentence, status: e.verdict, reason: e.reason, source_url: e.source_url });
  }
  const results = [...inherited, ...fresh.map((c) => known.get(c.sentence)!).filter(Boolean)];
  if (args.draftId) {
    await sb.from("content_drafts").update({ metadata: { ...meta, social_claims: results } }).eq("tenant_id", args.tenantId).eq("id", args.draftId);
  }
  return results
    .filter((r) => r.status === "contradicted" || r.status === "not_found" || r.status === "no_entry")
    .map((r) =>
      r.status === "contradicted"
        ? `New claim contradicted by its source: "${r.sentence}"`
        : `New legal claim not in the source blog and not verified: "${r.sentence}". Use the blog's wording or have an attorney confirm it.`,
    );
}
