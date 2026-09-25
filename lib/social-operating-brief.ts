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
   * The number blogs, pages and documents carry — NOT the social line.
   *
   * Diana's item 6: "social must contain 646-466-6267 ... documents use
   * 646-849-3352", and the same check now runs on blog and page bodies.
   *
   * Confirmed by Kenneth 2026-09-10, which also settled the conflict with
   * lib/km-content-system.ts — its Firm Context block said 212-460-0047, the
   * number that reached the Unpaid Wages blog four times, and now says this
   * one. Three numbers are in play and they are not interchangeable: this for
   * body copy, socialPhone for captions, and firmPhone in lib/firm-context.ts
   * (212-460-0047) for schema.org and directory NAP, which is checked for
   * consistency against the Google Business Profile and must not move.
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
   * "Consulta Gratuita" is deliberately NOT the wording. It trips the `fee`
   * rule in lib/social-compliance.ts, which blocks consultation-price language
   * in both languages — the same reason the English phrase says "Case Review"
   * rather than "Free Consultation". "Revisión" keeps the parallel and stays
   * clear of it.
   */
  offerPhraseEs: string;
  hashtagRule: string;
  /** Where the general-information disclaimer lives (S3, item 4). */
  disclaimerUrl: string;
};

// The offer phrase is a LOCKED string, not a paraphrase target: generation and
// the CTA engine insert it verbatim, capitals included, and the compliance
// check below is case-sensitive against it. Confirmed by Kenneth 2026-09-10.
// Changing the capitalisation here changes what every consultation CTA must
// read, so a tenant row in brand_voice_settings.socialOfferPhrase overrides it
// and must be updated (or cleared) alongside.
const DEFAULTS: OperatingBrief = {
  socialPhone: "646-466-6267",
  documentPhone: "646-849-3352",
  offerPhrase: "Free Confidential Case Review",
  offerPhraseEs: "Revisión Gratuita y Confidencial de su Caso",
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
