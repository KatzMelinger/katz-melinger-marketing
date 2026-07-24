/**
 * Feature flags. Per the master-spec ground rule, each feature ships behind an
 * on/off toggle so it can be enabled on staging before production. Flags are
 * env-driven and OFF by default — set the env var to on/1/true/yes to enable.
 *
 *   FRESHNESS_GATE — server-enforced hard gate on time-sensitive figures.
 */

const TRUE = new Set(["on", "1", "true", "yes"]);

function enabled(envVar: string): boolean {
  return TRUE.has((process.env[envVar] ?? "").trim().toLowerCase());
}

/** Server-side enforcement of the content-freshness hard gate (Part 1). */
export function freshnessGateEnabled(): boolean {
  return enabled("FRESHNESS_GATE");
}
