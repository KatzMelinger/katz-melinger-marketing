/**
 * The three rewrite reasons, and their labels (S12, item 16).
 *
 * A separate module because the composer is a client component and
 * lib/content-social.ts is not importable from one — it pulls in the Anthropic
 * SDK and the service-role Supabase client, both of which would land in the
 * browser bundle. Only the vocabulary is shared, so only the vocabulary moves.
 */

export type RewriteReason = "new_angle" | "stronger_hook" | "change_cta";

export const REWRITE_REASONS: readonly RewriteReason[] = [
  "new_angle",
  "stronger_hook",
  "change_cta",
];

/** Button text. Diana's wording, kept verbatim so the UI matches the spec. */
export const REWRITE_REASON_LABEL: Record<RewriteReason, string> = {
  new_angle: "Rewrite",
  stronger_hook: "More engaging",
  change_cta: "Change CTA",
};

/** What each button does, for the title attribute. */
export const REWRITE_REASON_HINT: Record<RewriteReason, string> = {
  new_angle: "A different angle on the same source, with its own hook",
  stronger_hook: "Same angle, a hook that stops the scroll",
  change_cta: "Keep the copy, swap the closing call to action",
};

export function isRewriteReason(v: unknown): v is RewriteReason {
  return typeof v === "string" && (REWRITE_REASONS as readonly string[]).includes(v);
}
