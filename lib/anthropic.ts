/**
 * Shared Anthropic client for MarketOS AI routes.
 *
 * Lazy-initialized so missing env vars don't break the Next.js build.
 * Single source of truth for the model name — bump it here when upgrading.
 */

import Anthropic from "@anthropic-ai/sdk";

// Use the latest Sonnet model. The Replit code referenced `claude-sonnet-4-6`,
// which is not a valid public model ID. We use the actual snapshot string.
// Update this single constant when bumping models across the keyword research
// feature.
export const KEYWORD_RESEARCH_MODEL = "claude-sonnet-4-5-20250929";

// Long-form content (blog posts, email newsletters, podcast scripts) and
// anything where the output style or factual accuracy materially matters.
// Same Sonnet snapshot as keyword research today.
export const CONTENT_LONG_FORM_MODEL = "claude-sonnet-4-5-20250929";

// Short-form content (LinkedIn, Twitter/X, Facebook, Instagram captions).
// Haiku is ~4× cheaper than Sonnet on output and is plenty for short social
// formats. Used in lib/content-multiformat.ts when the batch includes a mix
// of long-form and short-form formats — the batch is split into two parallel
// Claude calls, one per model.
export const CONTENT_SHORT_FORM_MODEL = "claude-haiku-4-5-20251001";

/**
 * Wraps a system prompt string in the array-of-content-blocks form the
 * Messages API uses for prompt caching, and tags it as ephemeral (5-min TTL).
 *
 * Below Anthropic's per-model token minimum the directive is silently
 * ignored — so we can always wrap and let the API decide whether to cache.
 */
export function cachedSystemPrompt(text: string) {
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to Vercel env vars (and .env.local for dev).",
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Pulls a JSON object out of a model response. Tolerates ```json fences,
 * stray prose before/after the object, and minor formatting quirks. Throws
 * if no JSON object can be found at all.
 */
export function extractJSON<T = unknown>(text: string): T {
  // Strip markdown code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return JSON.parse(fenced[1].trim()) as T;
  }
  // Otherwise grab the largest top-level brace block we can find.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in AI response");
  }
  return JSON.parse(match[0]) as T;
}
