/**
 * Shared social-post gate: S3 compliance + legal-accuracy + S13(b) inherited
 * findings + S13(d) source-currency. Used by every place a social post is
 * approved or scheduled (app/api/social/posts/[id]/route.ts,
 * app/api/content-production/repurpose/schedule/route.ts, and
 * app/api/content-production/social/route.ts) so the four checks can't drift
 * between call sites the way three independent copies of this logic did —
 * one of the three was already missing the inherited-findings hold and the
 * source-currency flag despite its own comment claiming full parity.
 */

import { checkSocialCompliance } from "./social-compliance";
import { runLegalCheck } from "./legal-verify";
import { syncFindings, listFindings } from "./content-findings-store";
import { checkSourceCurrency } from "./source-currency";
import { legalAccuracyEnabled } from "./feature-flags";
import type { OperatingBrief } from "./social-operating-brief";
import type { getTenantDb } from "./tenant-db";

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

export type SocialGateResult = {
  flagged: boolean;
  reasons: string[];
};

/** A draft's cta_type + source_blog_id (S2/S13b), from its own metadata. */
export async function loadDraftCtaAndSourceBlog(
  db: TenantDb,
  draftId: string | null,
): Promise<{ ctaType: string | null; sourceBlogId: string | null }> {
  if (!draftId) return { ctaType: null, sourceBlogId: null };
  const { data } = await db.from("content_drafts").select("metadata").eq("id", draftId).maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  return {
    ctaType: typeof meta.cta_type === "string" ? meta.cta_type : null,
    sourceBlogId: typeof meta.source_blog_id === "string" ? meta.source_blog_id : null,
  };
}

/** Merge one key into a content_drafts row's metadata. Best-effort — never throws. */
export async function patchDraftMetadata(
  db: TenantDb,
  draftId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data } = await db.from("content_drafts").select("metadata").eq("id", draftId).maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  await db
    .from("content_drafts")
    .update({ metadata: { ...meta, ...patch } })
    .eq("id", draftId)
    .then(undefined, () => {});
}

/**
 * Run the full gate for one post. `platform` should be the SINGLE platform
 * this exact content is being evaluated for — a caller posting one shared
 * body to several platforms at once should not force a single platform-
 * specific rule (e.g. Instagram's link-CTA check) onto content also going
 * to platforms that rule doesn't apply to; pass `undefined` in that case.
 *
 * `ctaType`/`sourceBlogId` may be passed pre-resolved (a caller that already
 * batch-fetched them) to avoid a redundant per-post lookup; otherwise they're
 * resolved here via `draftId`.
 */
export async function gateSocialPost(args: {
  content: string;
  platform: string | undefined;
  draftId: string | null;
  tenantId: string;
  db: TenantDb;
  operatingBrief: OperatingBrief;
  ctaType?: string | null;
  sourceBlogId?: string | null;
}): Promise<SocialGateResult> {
  const resolved =
    args.ctaType !== undefined && args.sourceBlogId !== undefined
      ? { ctaType: args.ctaType, sourceBlogId: args.sourceBlogId }
      : await loadDraftCtaAndSourceBlog(args.db, args.draftId);

  const blockingFlags = checkSocialCompliance(args.content, {
    socialPhone: args.operatingBrief.socialPhone,
    platform: args.platform,
    ctaType: resolved.ctaType ?? undefined,
    offerPhrase: args.operatingBrief.offerPhrase,
  }).filter((f) => f.severity === "block");

  // Legal-accuracy check, S13(b) inherited findings, and S13(d) source-currency
  // are independent of each other (none consumes another's result) — run them
  // concurrently rather than paying three sequential round trips (one of them
  // an LLM call) per post.
  const legalCheck = async (): Promise<string[]> => {
    if (!legalAccuracyEnabled() || !args.draftId) return [];
    try {
      const legal = await runLegalCheck(args.content, { tenantId: args.tenantId });
      await syncFindings({ draftId: args.draftId, tenantId: args.tenantId, incoming: legal.findings });
      return legal.findings.filter((f) => f.severity === "critical").map((f) => f.title);
    } catch (e) {
      console.warn(`[social-post-gate] legal check failed (draft ${args.draftId}):`, e);
      return ["Legal-accuracy check could not run"];
    }
  };

  // S13(b) — inherited findings: held if the source blog has an unresolved
  // finding. Live lookup, so resolving it on the blog clears the hold here
  // with no other change needed.
  const inheritedCheck = async (): Promise<string[]> => {
    if (!resolved.sourceBlogId) return [];
    const inherited = await listFindings(resolved.sourceBlogId).catch(() => []);
    return inherited.filter((f) => f.status === "open").map((f) => f.title);
  };

  // S13(d) — source-currency flag: advisory only, attached to the draft's
  // metadata, never a reason to flag/hold the post.
  const currencyCheck = async (): Promise<void> => {
    if (!resolved.sourceBlogId || !args.draftId) return;
    const currency = await checkSourceCurrency(resolved.sourceBlogId, args.tenantId).catch(() => null);
    if (currency) await patchDraftMetadata(args.db, args.draftId, { source_currency_flag: currency });
  };

  const [legalReasons, inheritedReasons] = await Promise.all([legalCheck(), inheritedCheck(), currencyCheck()]);

  const reasons = [
    ...blockingFlags.map((f) => f.label),
    ...legalReasons.map((t) => `Legal review: ${t}`),
    ...inheritedReasons.map((t) => `Source blog unresolved: ${t}`),
  ];
  return { flagged: reasons.length > 0, reasons };
}
