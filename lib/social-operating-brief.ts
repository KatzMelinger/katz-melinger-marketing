/**
 * S1 — Operating brief for social generation.
 *
 * A small, tenant-editable rule set (social phone number, offer phrase,
 * hashtag rule) injected into every social generation so posts don't rely on
 * the general firm-context phone number (lib/firm-context.ts), which is the
 * MAIN office line — social must use the dedicated social number instead.
 * Edited on /brand-voice like every other brand-voice field; stored in the
 * same brand_voice_settings key/value table (no migration).
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type OperatingBrief = {
  socialPhone: string;
  /**
   * The number blogs and web pages print (CTA and body copy).
   *
   * Diana confirmed 2026-10-01 that 212-460-0047 is the SWAP TARGET of the
   * CallRail Website pool: the page prints it and CallRail's script replaces
   * it per visitor with a tracking number, so each call is credited to its
   * marketing source. It is also the firm's NAP number (lib/firm-context.ts),
   * so schema, directories and the page agree. It replaced 646-849-3352,
   * which turned out to be one of the ROTATING pool numbers: printed on a
   * page, it credited calls to whichever visitor last had it.
   */
  webPhone: string;
  /**
   * The number PDFs and other documents carry: a FIXED CallRail number named
   * "Documents" (Diana, 2026-10-01), never swapped, so document calls get
   * their own source. Not for web pages: on a page it would bypass the swap.
   */
  documentPhone: string;
  offerPhrase: string;
  /**
   * The offer phrase for Spanish companions. Locked and checked verbatim, the
   * same way the English one is.
   *
   * It needs its own field because without one the check is unsatisfiable: a
   * Spanish caption cannot contain an English string the adapter is
   * translating, so every Spanish consultation post would be held for a
   * missing offer it could not have carried.
   *
   * "Evaluación" keeps the parallel with the English "Case Evaluation".
   */
  offerPhraseEs: string;
  hashtagRule: string;
  /** Where the general-information disclaimer lives (S3, item 4). */
  disclaimerUrl: string;
};

// The offer phrase is a LOCKED string, not a paraphrase target: generation and
// the CTA engine insert it verbatim, capitals included, and the compliance
// check below is case-sensitive against it. Confirmed by Kenneth 2026-09-10,
// changed by him 2026-09-29 from "...Case Review" to "...Case Evaluation" for
// every surface (blogs and web pages use the same phrase). Changing the capitalisation here changes what every consultation CTA must
// read, so a tenant row in brand_voice_settings.socialOfferPhrase overrides it
// and must be updated (or cleared) alongside.
const DEFAULTS: OperatingBrief = {
  socialPhone: "646-466-6267",
  webPhone: "212-460-0047",
  documentPhone: "646-692-0511",
  offerPhrase: "Free Confidential Case Evaluation",
  offerPhraseEs: "Evaluación Gratuita y Confidencial de su Caso",
  // Four to five, and the firm tag, because the S3 rule now CHECKS this.
  // It said "3 to 5" while the rule Diana specified requires four — generation
  // would have produced three and the gate would have held it every time.
  hashtagRule: "4 to 5 relevant hashtags, the last of them #KatzMelinger",
  disclaimerUrl: "/disclaimer/",
};

export async function getOperatingBrief(tenantId?: string): Promise<OperatingBrief> {
  const tid = tenantId ?? (await resolveTenantId());
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("brand_voice_settings")
      .select("key, value")
      .eq("tenant_id", tid)
      .in("key", [
        "socialPhone",
        "webPhone",
        "documentPhone",
        "socialOfferPhrase",
        "socialOfferPhraseEs",
        "socialHashtagRule",
        "socialDisclaimerUrl",
      ]);
    const settings: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row?.key && typeof row.value === "string" && row.value.trim()) {
        settings[row.key] = row.value.trim();
      }
    }
    return {
      socialPhone: settings.socialPhone || DEFAULTS.socialPhone,
      webPhone: settings.webPhone || DEFAULTS.webPhone,
      documentPhone: settings.documentPhone || DEFAULTS.documentPhone,
      offerPhrase: settings.socialOfferPhrase || DEFAULTS.offerPhrase,
      offerPhraseEs: settings.socialOfferPhraseEs || DEFAULTS.offerPhraseEs,
      hashtagRule: settings.socialHashtagRule || DEFAULTS.hashtagRule,
      disclaimerUrl: settings.socialDisclaimerUrl || DEFAULTS.disclaimerUrl,
    };
  } catch {
    return DEFAULTS;
  }
}
