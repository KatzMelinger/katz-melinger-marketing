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
 *   LEGAL_ACCURACY           — verify legal claims against approved authorities.
 *   CANNIBALIZATION_GATE     — hold a blog whose target keyword is already
 *                              owned by an existing service/practice-area page.
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

/**
 * Legal-accuracy checking at the approval gate (Diana's A1).
 *
 * Off by default and deliberately so. It costs a classification call plus a
 * retrieval and up to two verification calls PER CHECKABLE CLAIM, so it is not
 * something to switch on for a whole library without watching what it does
 * first. It also needs NY_LEGISLATION_API_KEY to check New York at all — the
 * flag being on without the key means every NY claim routes to an attorney,
 * which is safe but pointless.
 */
export function legalAccuracyEnabled(): boolean {
  return enabled("LEGAL_ACCURACY");
}

/**
 * Commercial-cannibalization hard gate at approval (spec item 5).
 *
 * Off by default until the firm has reviewed how it behaves — it depends on
 * `site_pages` being populated by the sitemap crawler, and a firm that hasn't
 * run that crawl yet would otherwise get a gate that can never find anything
 * to check (harmless, but worth turning on deliberately rather than silently).
 */
export function cannibalizationGateEnabled(): boolean {
  return enabled("CANNIBALIZATION_GATE");
}
