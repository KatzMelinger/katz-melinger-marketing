/**
 * Feature flags. Per the master-spec ground rule, each feature ships behind an
 * on/off toggle so it can be enabled on staging before production. Flags are
 * env-driven and OFF by default — set the env var to on/1/true/yes to enable.
 *
 *   FRESHNESS_GATE           — server-enforced hard gate on time-sensitive figures.
 *   READABILITY_RULES_ENGINE — score against the 15 KM rules, not Flesch-Kincaid.
 *   EEAT_AUTHORSHIP          — credentialed author bio box on content.
 *   SOCIAL_MULTIFORMAT       — per-platform format → Ayrshare post-type on publish.
 *   NATIVE_SOCIAL_ANALYTICS  — account-level reach/engagement from Ayrshare.
 */

const TRUE = new Set(["on", "1", "true", "yes"]);

function enabled(envVar: string): boolean {
  return TRUE.has((process.env[envVar] ?? "").trim().toLowerCase());
}

/** Server-side enforcement of the content-freshness hard gate (Part 1). */
export function freshnessGateEnabled(): boolean {
  return enabled("FRESHNESS_GATE");
}

/** Rule-based readability scoring in place of Flesch-Kincaid (Part 2). */
export function readabilityRulesEngineEnabled(): boolean {
  return enabled("READABILITY_RULES_ENGINE");
}

/** Credentialed author bio box on generated/refreshed content (Part 3). */
export function eeatAuthorshipEnabled(): boolean {
  return enabled("EEAT_AUTHORSHIP");
}

/** Per-platform format → Ayrshare post-type mapping on publish (Part 4A). */
export function socialMultiformatEnabled(): boolean {
  return enabled("SOCIAL_MULTIFORMAT");
}

/** Account-level analytics pulled from Ayrshare rather than Metricool (Part 4B). */
export function nativeSocialAnalyticsEnabled(): boolean {
  return enabled("NATIVE_SOCIAL_ANALYTICS");
}
