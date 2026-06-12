/**
 * Cannibalization action labels (intelligence-layer Step 3).
 *
 * Decides whether a page decision is a Create / Optimize / Update — or needs no
 * action at all. The spec's canonical signals are the WordPress URL inventory
 * and live Google Search Console positions, but this resolver is written to
 * degrade gracefully: when GSC/WP data isn't wired yet, it falls back to the
 * SEMrush rank we already have (our_position), so labels are still meaningful.
 *
 *   Create   — no existing URL covers the keyword group.
 *   Optimize — a URL exists but ranks below position 20 (or we have no rank).
 *   Update   — a URL exists, ranks in the top 20, but content is stale (>6mo)
 *              or content-age is unknown (treated as a refresh candidate).
 *   null     — a URL exists, ranks top 20, and is provably fresh → nothing to do.
 */

import type { ActionLabel } from "./opportunity-scoring";

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 182;

export function deriveActionLabel(input: {
  existingUrl: string | null;
  /** SEMrush organic rank — the always-available fallback signal. */
  ourPosition: number | null;
  /** Persisted Google Search Console position, when available (preferred). */
  gscPosition?: number | null;
  /** WordPress content modified timestamp, when available. */
  existingUrlModifiedAt?: string | null;
  /** Injectable clock for testing; defaults to now. */
  now?: number;
}): ActionLabel | null {
  if (!input.existingUrl) return "create";

  // Prefer a real GSC position; fall back to the SEMrush rank we already store.
  const pos = input.gscPosition ?? input.ourPosition ?? null;
  if (pos == null || pos > 20) return "optimize";

  // Top 20: only "update" when content is stale, or when we can't yet prove
  // freshness (no WP modified date wired). A provably-fresh top-20 page needs
  // no action.
  if (input.existingUrlModifiedAt) {
    const ageMs = (input.now ?? Date.now()) - new Date(input.existingUrlModifiedAt).getTime();
    return ageMs > SIX_MONTHS_MS ? "update" : null;
  }
  return "update";
}
