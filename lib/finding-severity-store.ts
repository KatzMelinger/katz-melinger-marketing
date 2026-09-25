/**
 * The firm's edits to the per-rule severity map (item 12's "editable table").
 *
 * Defaults live in lib/finding-severity.ts. This reads only the rows where the
 * firm has moved a rule OFF its default, so an empty table means "the defaults
 * are right" rather than "nothing is classified" — which is what a table that
 * shipped empty would have meant, and why the defaults are not seeded here.
 *
 * Degrades to {} if the migration has not been run, matching how every other
 * findings store behaves: the panel renders on defaults rather than erroring.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { severityRuleKey, type PublishSeverity, type SeverityOverrides } from "./finding-severity";
import type { FindingSource } from "./content-findings";

/* eslint-disable @typescript-eslint/no-explicit-any */

const VALID: ReadonlySet<string> = new Set(["blocker", "recommended", "optional"]);

export async function getSeverityOverrides(tenantId: string): Promise<SeverityOverrides> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("finding_severity_rules")
      .select("source, rule_id, severity")
      .eq("tenant_id", tenantId);
    if (error) {
      if (!/finding_severity_rules|does not exist|schema cache/i.test(error.message)) {
        console.warn("[finding-severity] load failed:", error.message);
      }
      return {};
    }
    const out: Record<string, PublishSeverity> = {};
    for (const row of (data ?? []) as any[]) {
      if (!row?.source || !VALID.has(row.severity)) continue;
      const key = severityRuleKey(row.source as FindingSource, row.rule_id || null);
      out[key] = row.severity as PublishSeverity;
    }
    return out;
  } catch (e) {
    console.warn("[finding-severity] load failed:", e);
    return {};
  }
}
