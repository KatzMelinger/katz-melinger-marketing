/**
 * S2 — CTA Decision Engine.
 *
 * Chooses a call-to-action per post from 3 signals (intent, sensitivity,
 * platform — "format" and "platform" are the same axis for social in this
 * codebase, see lib/social-format-rules.ts) rather than the single generic
 * soft-CTA instruction every format got before. Deterministic, not learned —
 * the Step 4 analytics-feedback loop from the spec is a separate, later
 * project once cta_type has actually been collected for a while.
 *
 * Anti-repetition mirrors lib/social-duplicate.ts's join pattern: read recent
 * social_posts for the tenant/platform, resolve each to its source draft's
 * cta_type via content_drafts.metadata, and avoid repeating the same cta_type
 * back-to-back on that platform. Fails soft — a query error just means no
 * repetition history, never a broken generation.
 */

import { getSupabaseAdmin } from "./supabase-server";
import type { KMSearchIntent } from "./km-content-system";
import type { SocialFormatKey } from "./social-format-rules";

export type CtaType = "consultation" | "learn_more" | "conversation" | "engage";
export type CtaMechanism = "consultation_link" | "link_in_bio" | "call_phone";

export type CtaChoice = { ctaType: CtaType; ctaMechanism: CtaMechanism };

/** Per-platform delivery mechanic — a link only works where the channel renders it live. */
function mechanismFor(platform: SocialFormatKey, ctaType: CtaType): CtaMechanism {
  if (platform === "carousel" || platform === "video_short") return "call_phone";
  if (platform === "instagram") return ctaType === "engage" ? "call_phone" : "link_in_bio";
  return "consultation_link"; // linkedin, facebook, twitter — a caption link works
}

/** Ordered fallback candidates for a given (intent, sensitive) pair, most-preferred first. */
function candidatesFor(intent: KMSearchIntent, sensitive: boolean): CtaType[] {
  if (sensitive) return ["conversation", "engage", "learn_more"];
  if (intent === "commercial" || intent === "proof") return ["consultation", "engage", "learn_more"];
  return ["learn_more", "engage", "consultation"];
}

/** Human-readable instruction line injected into the generation prompt for this format. */
export function ctaInstruction(choice: CtaChoice, socialPhone: string): string {
  const byType: Record<CtaType, string> = {
    consultation: "Invite them to reach out for a consultation",
    learn_more: "Invite them to learn more / keep reading",
    conversation: "A low-pressure, supportive invitation to talk it through — never a sales push",
    engage: "A low-commitment invite to comment, DM, or share",
  };
  const byMechanism: Record<CtaMechanism, string> = {
    consultation_link: "a direct link or contact prompt is fine in the caption",
    link_in_bio: "do NOT say \"click the link\" or include a raw URL — say \"link in bio\" instead",
    call_phone: `end with the phone number ${socialPhone}, spoken/visible, not a link`,
  };
  return `CTA: ${byType[choice.ctaType]}. ${byMechanism[choice.ctaMechanism]}.`;
}

/**
 * The most recently used cta_type per platform, from the last 50 scheduled/
 * published posts. Rows are already ordered newest-first, so the first match
 * per platform wins and later ones are ignored.
 */
export async function loadRecentCtas(tenantId: string): Promise<Map<string, CtaType>> {
  const byPlatform = new Map<string, CtaType>();
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("social_posts")
      .select("platform, source_draft_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data?.length) return byPlatform;

    const draftIds = [...new Set(data.map((r) => r.source_draft_id).filter(Boolean))] as string[];
    if (!draftIds.length) return byPlatform;
    const { data: drafts } = await sb
      .from("content_drafts")
      .select("id, metadata")
      .in("id", draftIds);
    const ctaByDraft = new Map<string, CtaType>();
    for (const d of (drafts ?? []) as Array<{ id: string; metadata: unknown }>) {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      const cta = meta.cta_type;
      if (typeof cta === "string") ctaByDraft.set(d.id, cta as CtaType);
    }
    for (const r of data as Array<{ platform: string; source_draft_id: string | null }>) {
      if (byPlatform.has(r.platform)) continue; // newest already recorded for this platform
      const cta = r.source_draft_id ? ctaByDraft.get(r.source_draft_id) : undefined;
      if (cta) byPlatform.set(r.platform, cta);
    }
    return byPlatform;
  } catch {
    return byPlatform;
  }
}

/**
 * Choose a CTA for one format. `recentByPlatform` is the last-used cta_type
 * per platform (most recent first) — pass the result of loadRecentCtas() once
 * per generation batch rather than querying per format.
 */
export function chooseCta(args: {
  intent: KMSearchIntent;
  sensitive: boolean;
  platform: SocialFormatKey;
  recentByPlatform?: Map<string, CtaType>;
}): CtaChoice {
  const candidates = candidatesFor(args.intent, args.sensitive);
  const lastUsed = args.recentByPlatform?.get(args.platform);
  // Skip the top candidate only if it's an exact repeat of the last post on
  // this platform AND an alternative exists — never repeats twice in a row.
  const ctaType =
    lastUsed && lastUsed === candidates[0] && candidates.length > 1 ? candidates[1] : candidates[0];
  return { ctaType, ctaMechanism: mechanismFor(args.platform, ctaType) };
}
