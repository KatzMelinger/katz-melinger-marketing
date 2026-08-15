/**
 * Server-only loader for the editable readability config (Part 2, slice 5).
 *
 * Split from lib/readability-rules.ts — which is pure and imported by client
 * components — so the Supabase client and next/headers never reach the client
 * bundle. Mirrors lib/current-facts-store.ts.
 *
 * Every table is optional. An empty or unreachable table falls back to the
 * code-seeded defaults, so the engine scores identically before the migration
 * runs and if the database is briefly unavailable. Readability is advisory;
 * failing a draft because a config table timed out would be worse than scoring
 * it against the shipped defaults.
 */

import {
  DEFAULT_READABILITY_CONFIG,
  READABILITY_RULES,
  type ReadabilityConfig,
  type RuleId,
} from "./readability-rules";
import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

const VALID_RULE_IDS = new Set<string>(READABILITY_RULES.map((r) => r.id));

/**
 * Live config for a tenant. Each of the three pieces falls back independently:
 * a populated dictionary still applies even if the allowlist table is empty.
 * Pass an explicit tenantId from background/cron contexts.
 */
export async function getReadabilityConfig(tenantId?: string): Promise<ReadabilityConfig> {
  try {
    const tid = tenantId ?? (await resolveTenantId());
    const sb = getSupabaseAdmin();

    const [settings, words, allow] = await Promise.all([
      sb.from("readability_rule_settings").select("rule_id, enabled").eq("tenant_id", tid),
      sb.from("plainword_dictionary").select("complex, plain").eq("tenant_id", tid),
      sb.from("legal_allowlist").select("term").eq("tenant_id", tid),
    ]);

    // Only rows that explicitly disable a known rule matter; absent = enabled.
    const disabledRuleIds = (settings.data ?? [])
      .filter((r) => r.enabled === false && VALID_RULE_IDS.has(String(r.rule_id)))
      .map((r) => String(r.rule_id) as RuleId);

    const wordRows = (words.data ?? []).filter(
      (r) => String(r.complex ?? "").trim() && String(r.plain ?? "").trim(),
    );
    const plainwords = wordRows.length
      ? Object.fromEntries(
          wordRows.map((r) => [String(r.complex).trim().toLowerCase(), String(r.plain).trim()]),
        )
      : DEFAULT_READABILITY_CONFIG.plainwords;

    const allowRows = (allow.data ?? [])
      .map((r) => String(r.term ?? "").trim())
      .filter(Boolean);
    // The allowlist is what stops Rule 15 mangling a term of art, so an edited
    // list ADDS to the shipped one rather than replacing it. Dropping a default
    // term by omission would silently start rewriting legal language.
    const allowlist = allowRows.length
      ? [...new Set([...DEFAULT_READABILITY_CONFIG.allowlist, ...allowRows])]
      : DEFAULT_READABILITY_CONFIG.allowlist;

    return { plainwords, allowlist, disabledRuleIds };
  } catch {
    return DEFAULT_READABILITY_CONFIG;
  }
}
