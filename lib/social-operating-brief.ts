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
  offerPhrase: string;
  hashtagRule: string;
};

const DEFAULTS: OperatingBrief = {
  socialPhone: "646-466-6267",
  offerPhrase: "a free, confidential case review",
  hashtagRule: "3 to 5 relevant hashtags",
};

export async function getOperatingBrief(tenantId?: string): Promise<OperatingBrief> {
  const tid = tenantId ?? (await resolveTenantId());
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("brand_voice_settings")
      .select("key, value")
      .eq("tenant_id", tid)
      .in("key", ["socialPhone", "socialOfferPhrase", "socialHashtagRule"]);
    const settings: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row?.key && typeof row.value === "string" && row.value.trim()) {
        settings[row.key] = row.value.trim();
      }
    }
    return {
      socialPhone: settings.socialPhone || DEFAULTS.socialPhone,
      offerPhrase: settings.socialOfferPhrase || DEFAULTS.offerPhrase,
      hashtagRule: settings.socialHashtagRule || DEFAULTS.hashtagRule,
    };
  } catch {
    return DEFAULTS;
  }
}
