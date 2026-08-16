/**
 * Shared Anthropic client for Huraqan AI routes.
 *
 * Lazy-initialized so missing env vars don't break the Next.js build.
 * Single source of truth for the model name — bump it here when upgrading.
 */

import Anthropic from "@anthropic-ai/sdk";

// Update this single constant when bumping models across the keyword research
// feature.
//
// NOTE: an earlier comment here claimed `claude-sonnet-4-6` "is not a valid
// public model ID". It is. Newer Sonnet/Opus models also have a much lower
// prompt-cache minimum than the snapshot below (see CACHE_MIN_TOKENS), so a
// model bump is the single biggest lever on cache hit rate. Bumping is a
// behavioral change with its own migration checklist (tokenizer, sampling
// params, thinking config) — decide it deliberately, don't drift into it.
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
 * Minimum cacheable prefix, in tokens, by model.
 *
 * THIS IS THE THING THAT SILENTLY BREAKS CACHING. Below the minimum, a
 * `cache_control` marker is ignored with no error and no warning — the response
 * just comes back with `cache_creation_input_tokens: 0`. A call site can look
 * fully cached and never cache once.
 *
 * The minimum is NOT monotonic across generations: Haiku 4.5 needs 4× the
 * prefix Sonnet 4.5 does, so the short-form social path — the highest-volume
 * generator here — needs a ~4k-token system prompt before caching does anything
 * at all. Newer models drop as low as 512.
 */
export const CACHE_MIN_TOKENS: Record<string, number> = {
  "claude-sonnet-4-5-20250929": 1024,
  "claude-haiku-4-5-20251001": 4096,
};

/** Rough token estimate (~4 chars/token) — enough to compare against a minimum. */
function approxTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

/**
 * Whether a system prompt is actually long enough to cache on a given model.
 * Use it before assuming a hit rate is a bug rather than a threshold.
 */
export function willCache(model: string, text: string): boolean {
  const min = CACHE_MIN_TOKENS[model];
  if (min === undefined) return true; // unknown model — don't claim it won't
  return approxTokens(text) >= min;
}

/**
 * Wraps a system prompt string in the array-of-content-blocks form the
 * Messages API uses for prompt caching, and tags it as ephemeral (5-min TTL).
 *
 * Below the per-model minimum the directive is silently ignored, so wrapping is
 * always safe — but "wrapped" is not "cached". Pass `model` to get a one-time
 * dev warning when the prompt is too short to ever cache on it.
 *
 * Caching is a PREFIX match: anything interpolated into `text` that changes per
 * request (a timestamp, a matter id, a session id) invalidates the whole entry.
 * Keep those in the user turn, not here.
 */
export function cachedSystemPrompt(text: string, model?: string) {
  if (model && process.env.NODE_ENV !== "production" && !willCache(model, text)) {
    warnUncacheable(model, approxTokens(text));
  }
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

const warned = new Set<string>();
function warnUncacheable(model: string, tokens: number) {
  const key = `${model}:${tokens}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[anthropic] system prompt is ~${tokens} tokens but ${model} needs ` +
      `${CACHE_MIN_TOKENS[model]} to cache — cache_control will be ignored here.`,
  );
}

/**
 * Log what a response actually did with the cache.
 *
 * Reach for this before theorising about a low hit rate: if
 * `cache_read_input_tokens` is 0 across repeated requests that should share a
 * prefix, something is invalidating it — and this says which call site.
 * Off unless ANTHROPIC_LOG_CACHE is set, so it costs nothing in normal runs.
 */
export function logCacheUsage(
  label: string,
  usage: {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    input_tokens?: number | null;
  } | null | undefined,
) {
  if (!process.env.ANTHROPIC_LOG_CACHE || !usage) return;
  const read = usage.cache_read_input_tokens ?? 0;
  const wrote = usage.cache_creation_input_tokens ?? 0;
  const fresh = usage.input_tokens ?? 0;
  console.log(
    `[anthropic:cache] ${label} read=${read} wrote=${wrote} uncached=${fresh}` +
      (read === 0 && wrote === 0 ? " (NOT CACHING — prefix below the model minimum?)" : ""),
  );
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
