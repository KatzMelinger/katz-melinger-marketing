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
import { runTrapCheck } from "./trap-gate";
import { syncFindings, listFindings } from "./content-findings-store";
import { checkSourceCurrency } from "./source-currency";
import { legalAccuracyEnabled } from "./feature-flags";
import type { NormalizedFinding } from "./content-findings";
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

/** A draft's cta_type + source_blog_id (S2/S13b) + language, from its metadata. */
export async function loadDraftCtaAndSourceBlog(
  db: TenantDb,
  draftId: string | null,
): Promise<{ ctaType: string | null; sourceBlogId: string | null; language: string | null }> {
  if (!draftId) return { ctaType: null, sourceBlogId: null, language: null };
  const { data } = await db.from("content_drafts").select("metadata").eq("id", draftId).maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  return {
    ctaType: typeof meta.cta_type === "string" ? meta.cta_type : null,
    sourceBlogId: typeof meta.source_blog_id === "string" ? meta.source_blog_id : null,
    language: typeof meta.language === "string" ? meta.language : null,
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
  /** BCP-47-ish language tag from the draft's metadata ("es" for a Spanish
   *  companion). Pass it alongside a pre-resolved ctaType/sourceBlogId. */
  language?: string | null;
  /** The social format — carousels and scripts carry no hashtag block. */
  format?: string | null;
}): Promise<SocialGateResult> {
  const resolved =
    args.ctaType !== undefined && args.sourceBlogId !== undefined
      ? { ctaType: args.ctaType, sourceBlogId: args.sourceBlogId, language: args.language ?? null }
      : await loadDraftCtaAndSourceBlog(args.db, args.draftId);

  // A Spanish (or any non-English) companion. Declared up here because both
  // halves of the gate need it: the compliance check picks the language's offer
  // phrase, and the legal half skips the authority loop.
  const isCompanionTranslation = resolved.language != null && resolved.language !== "en";

  // Compliance is the one platform-specific check (Instagram's link-CTA rule).
  // Check against EVERY target platform and union the blocking flags (deduped
  // by code) rather than picking a single platform — a shared body going to
  // several platforms at once must still be checked against each of them.
  const platforms = Array.isArray(args.platform) ? args.platform : args.platform ? [args.platform] : [undefined];
  const complianceFlagsByCode = new Map<string, string>();
  for (const platform of platforms) {
    for (const f of checkSocialCompliance(args.content, {
      assetType: "social",
      socialPhone: args.operatingBrief.socialPhone,
      platform,
      format: args.format ?? undefined,
      ctaType: resolved.ctaType ?? undefined,
      // A Spanish companion is checked against the Spanish offer phrase. With
      // one phrase for both, every Spanish consultation post would be held for
      // a missing offer it could not have carried.
      offerPhrase: isCompanionTranslation
        ? args.operatingBrief.offerPhraseEs
        : args.operatingBrief.offerPhrase,
      disclaimerUrl: args.operatingBrief.disclaimerUrl,
    })) {
      if (f.severity === "block") complianceFlagsByCode.set(f.code, f.label);
    }
  }
  const blockingFlags = [...complianceFlagsByCode.values()];

  // The two legal producers, and why only one of them is behind a flag.
  //
  // Traps are a text search over patterns that have already been wrong once
  // (lib/trap-gate.ts). No model call, no retrieval, so there is nothing to
  // meter and no reason to gate it — it runs on every post, including the ones
  // the authority loop is deliberately not spent on. It is what actually
  // catches the seeded errors, like the NYSHRL employer-size threshold.
  //
  // The authority loop (runLegalCheck) reasons about cited claims and costs a
  // classification call plus up to two verification calls per claim, each
  // carrying statute text. It stays behind LEGAL_ACCURACY, and it is skipped on
  // Spanish companions: a companion is a translation of English copy that
  // already cleared this same gate, so re-running the expensive half would pay
  // twice to verify one set of claims. The companion still gets the traps, the
  // compliance rules, and its source blog's inherited findings — everything
  // that could catch a problem the English original did not have.
  const legalCheck = async (): Promise<{
    reasons: string[];
    findings: NormalizedFinding[];
    failed: boolean;
  }> => {
    if (!legalAccuracyEnabled() || !args.draftId || isCompanionTranslation) {
      return { reasons: [], findings: [], failed: false };
    }
    try {
      const legal = await runLegalCheck(args.content, { tenantId: args.tenantId });
      const critical = legal.findings.filter((f) => f.severity === "critical").map((f) => f.title);
      return { reasons: critical, findings: legal.findings, failed: false };
    } catch (e) {
      console.warn(`[social-post-gate] legal check failed (draft ${args.draftId}):`, e);
      return { reasons: ["Legal-accuracy check could not run"], findings: [], failed: true };
    }
  };

  const trapCheck = async (): Promise<{
    reasons: string[];
    findings: NormalizedFinding[];
    failed: boolean;
  }> => {
    if (!args.draftId) return { reasons: [], findings: [], failed: false };
    try {
      const traps = await runTrapCheck(args.content, { tenantId: args.tenantId });
      return {
        reasons: traps.blockingReasons,
        findings: traps.findings,
        failed: traps.failed,
      };
    } catch (e) {
      console.warn(`[social-post-gate] trap check failed (draft ${args.draftId}):`, e);
      return { reasons: [], findings: [], failed: true };
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

  // Run all four concurrently, but await each by name (not by Promise.all array
  // position) so a future fifth check — or currencyCheck someday returning a
  // value — can't silently shift what this destructure reads. currencyPromise
  // is still started here (not after) to keep it running alongside the others,
  // not sequentially behind them.
  const legalPromise = legalCheck();
  const trapPromise = trapCheck();
  const inheritedPromise = inheritedCheck();
  const currencyPromise = currencyCheck();
  const [legal, traps, inheritedReasons] = await Promise.all([
    legalPromise,
    trapPromise,
    inheritedPromise,
  ]);
  await currencyPromise;

  // ONE sync for both legal producers, scoped to `legal`.
  //
  // Both of these write under source `legal`, and syncFindings auto-resolves
  // anything in a recomputed source it was not handed — so two separate calls
  // would each close the other's findings. They are merged here instead.
  //
  // The `sources` scope is what keeps this partial run from closing findings no
  // engine here looked for: without it, approving a post would silently resolve
  // its readability, SEO and compliance findings, because this gate does not
  // produce any. It is also why a failed run writes nothing at all — a check
  // that could not run has no opinion, and recording that as "no findings"
  // would auto-resolve the real ones it failed to reproduce.
  const legalProducersRan = !legal.failed && !traps.failed;
  if (args.draftId && legalProducersRan) {
    await syncFindings({
      draftId: args.draftId,
      tenantId: args.tenantId,
      incoming: [...legal.findings, ...traps.findings],
      sources: ["legal"],
    });
  }

  const reasons = [
    ...blockingFlags,
    ...traps.reasons.map((t) => `Known trap: ${t}`),
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
