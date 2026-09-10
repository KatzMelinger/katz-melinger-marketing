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
  /** True if S13(b) held for an unresolved finding on the source blog — the
   *  caller can use this to point the reviewer at the source blog specifically
   *  rather than a generic "clear the flag" message. */
  inheritedFindingHold: boolean;
  /**
   * True if the legal-accuracy check itself failed to run (infra failure —
   * timeout, service down), as opposed to running and finding a real
   * critical claim. A caller that wants to distinguish "hold, edit and
   * clear" from "transient failure, just retry" (as
   * app/api/social/posts/[id]/route.ts does) should check this BEFORE
   * treating `flagged` as an ordinary compliance hold.
   */
  legalCheckFailed: boolean;
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

/**
 * Merge one key into a content_drafts row's metadata. Best-effort — never
 * throws (callers rely on this to be a pure side effect that can't fail the
 * gate). If the read fails or returns no row, this is a no-op rather than
 * writing `patch` as the row's entire metadata — a failed read must never
 * look like "this draft has no other metadata" and silently wipe cta_type /
 * source_blog_id / anything else already stored there.
 */
export async function patchDraftMetadata(
  db: TenantDb,
  draftId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { data, error } = await db.from("content_drafts").select("metadata").eq("id", draftId).maybeSingle();
    if (error || !data) {
      console.warn(`[social-post-gate] patchDraftMetadata: could not read draft ${draftId}, skipping patch`, error);
      return;
    }
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    await db.from("content_drafts").update({ metadata: { ...meta, ...patch } }).eq("id", draftId);
  } catch (e) {
    console.warn(`[social-post-gate] patchDraftMetadata failed for draft ${draftId}:`, e);
  }
}

/**
 * Run the full gate for one post. `platform` is every platform this exact
 * body is being sent to — pass all of them (not just one) so a
 * platform-specific rule (e.g. Instagram's link-CTA check) is evaluated
 * whenever that platform is among the targets, even when the same body also
 * goes to other platforms the rule doesn't apply to.
 *
 * `ctaType`/`sourceBlogId` may be passed pre-resolved (a caller that already
 * batch-fetched them) to avoid a redundant per-post lookup; otherwise they're
 * resolved here via `draftId`.
 */
export async function gateSocialPost(args: {
  content: string;
  platform: string | string[] | undefined;
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

  // Compliance is the one platform-specific check (Instagram's link-CTA rule).
  // Check against EVERY target platform and union the blocking flags (deduped
  // by code) rather than picking a single platform — a shared body going to
  // several platforms at once must still be checked against each of them.
  const platforms = Array.isArray(args.platform) ? args.platform : args.platform ? [args.platform] : [undefined];
  const complianceFlagsByCode = new Map<string, string>();
  for (const platform of platforms) {
    for (const f of checkSocialCompliance(args.content, {
      socialPhone: args.operatingBrief.socialPhone,
      platform,
      ctaType: resolved.ctaType ?? undefined,
      offerPhrase: args.operatingBrief.offerPhrase,
    })) {
      if (f.severity === "block") complianceFlagsByCode.set(f.code, f.label);
    }
  }
  const blockingFlags = [...complianceFlagsByCode.values()];

  // Legal-accuracy check, S13(b) inherited findings, and S13(d) source-currency
  // are independent of each other (none consumes another's result) — run them
  // concurrently rather than paying three sequential round trips (one of them
  // an LLM call) per post. Each is individually guarded so a failure in one
  // (including its own best-effort DB writes) can never fail the other two or
  // the gate as a whole.
  const legalCheck = async (): Promise<{ reasons: string[]; failed: boolean }> => {
    if (!legalAccuracyEnabled() || !args.draftId) return { reasons: [], failed: false };
    try {
      const legal = await runLegalCheck(args.content, { tenantId: args.tenantId });
      await syncFindings({ draftId: args.draftId, tenantId: args.tenantId, incoming: legal.findings });
      const critical = legal.findings.filter((f) => f.severity === "critical").map((f) => f.title);
      return { reasons: critical, failed: false };
    } catch (e) {
      console.warn(`[social-post-gate] legal check failed (draft ${args.draftId}):`, e);
      return { reasons: ["Legal-accuracy check could not run"], failed: true };
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
  // metadata, never a reason to flag/hold the post. patchDraftMetadata never
  // throws (see above), so this can't fail the surrounding Promise.all.
  const currencyCheck = async (): Promise<void> => {
    if (!resolved.sourceBlogId || !args.draftId) return;
    const currency = await checkSourceCurrency(resolved.sourceBlogId, args.tenantId).catch(() => null);
    if (currency) await patchDraftMetadata(args.db, args.draftId, { source_currency_flag: currency });
  };

  // Run all three concurrently, but await legal/inherited by name (not by
  // Promise.all array position) so a future fourth check — or currencyCheck
  // someday returning a value — can't silently shift what this destructure
  // reads. currencyPromise is still started here (not after) to keep it
  // running alongside the other two, not sequentially behind them.
  const legalPromise = legalCheck();
  const inheritedPromise = inheritedCheck();
  const currencyPromise = currencyCheck();
  const [legal, inheritedReasons] = await Promise.all([legalPromise, inheritedPromise]);
  await currencyPromise;

  const reasons = [
    ...blockingFlags,
    ...legal.reasons.map((t) => `Legal review: ${t}`),
    ...inheritedReasons.map((t) => `Source blog unresolved: ${t}`),
  ];
  return {
    flagged: reasons.length > 0,
    reasons,
    inheritedFindingHold: inheritedReasons.length > 0,
    legalCheckFailed: legal.failed,
  };
}
