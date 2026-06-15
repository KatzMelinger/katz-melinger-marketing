/**
 * CRUD + lookup helpers for the ad-compliance knowledge base:
 *   - state_compliance_rules  (per-jurisdiction attorney-advertising framework)
 *   - compliance_disclaimers  (reusable required-disclaimer snippets)
 *
 * Both are tenant-scoped — reads auto-scope via RLS (getTenantClient), writes
 * stamp tenant_id. The two get*ForJurisdictions helpers feed lib/ads-compliance.
 */

import { getTenantClient } from "@/lib/tenant-db";

export type ReviewStatus =
  | "unverified"
  | "verified"
  | "needs_review"
  | "archived";

export type KeyRule = {
  citation: string;
  rule: string;
  severity: "high" | "medium" | "low";
};

export type StateComplianceRule = {
  id: string;
  jurisdiction_code: string;
  jurisdiction_name: string;
  governing_authority: string | null;
  rules_summary: string | null;
  key_rules: KeyRule[];
  required_label: string | null;
  notes: string | null;
  enabled: boolean;
  review_status: ReviewStatus;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ComplianceDisclaimer = {
  id: string;
  label: string;
  text: string;
  jurisdiction: string | null;
  trigger: string | null;
  practice_area: string | null;
  enabled: boolean;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// State Compliance Rules
// ---------------------------------------------------------------------------

export async function listStateRules(opts?: {
  enabledOnly?: boolean;
}): Promise<StateComplianceRule[]> {
  const { supabase: sb } = await getTenantClient();
  let q = sb
    .from("state_compliance_rules")
    .select("*")
    .order("jurisdiction_name", { ascending: true });
  if (opts?.enabledOnly) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as StateComplianceRule[];
}

export async function upsertStateRule(
  row: Partial<StateComplianceRule> & {
    jurisdiction_code: string;
    jurisdiction_name: string;
  },
): Promise<StateComplianceRule> {
  const { supabase: sb, tenantId } = await getTenantClient();
  const payload: Record<string, unknown> = {
    jurisdiction_code: row.jurisdiction_code,
    jurisdiction_name: row.jurisdiction_name,
    governing_authority: row.governing_authority ?? null,
    rules_summary: row.rules_summary ?? null,
    key_rules: row.key_rules ?? [],
    required_label: row.required_label ?? null,
    notes: row.notes ?? null,
    enabled: row.enabled ?? true,
    review_status: row.review_status ?? "unverified",
    last_verified_at: row.last_verified_at ?? null,
    tenant_id: tenantId,
  };
  if (row.id) payload.id = row.id;
  const { data, error } = await sb
    .from("state_compliance_rules")
    .upsert(payload, { onConflict: "tenant_id,jurisdiction_code" })
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "upsert failed");
  return data as StateComplianceRule;
}

export async function deleteStateRule(id: string): Promise<void> {
  const { supabase: sb } = await getTenantClient();
  const { error } = await sb
    .from("state_compliance_rules")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Bulk-insert seeded state rules, skipping any jurisdiction_code that already
 * exists for the tenant. Returns the number inserted. Seeded rows are always
 * unverified — they must be reviewed by counsel before being relied upon.
 */
export async function insertStateRulesIfMissing(
  rows: Array<
    Partial<StateComplianceRule> & {
      jurisdiction_code: string;
      jurisdiction_name: string;
    }
  >,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { supabase: sb, tenantId } = await getTenantClient();

  const { data: existing } = await sb
    .from("state_compliance_rules")
    .select("jurisdiction_code");
  const seen = new Set(
    (existing ?? []).map((r) => (r.jurisdiction_code as string).toUpperCase()),
  );

  const fresh = rows.filter((r) => {
    const code = r.jurisdiction_code.toUpperCase();
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
  if (fresh.length === 0) return 0;

  const payload = fresh.map((r) => ({
    jurisdiction_code: r.jurisdiction_code,
    jurisdiction_name: r.jurisdiction_name,
    governing_authority: r.governing_authority ?? null,
    rules_summary: r.rules_summary ?? null,
    key_rules: r.key_rules ?? [],
    required_label: r.required_label ?? null,
    notes: r.notes ?? null,
    enabled: true,
    review_status: "unverified" as const,
    tenant_id: tenantId,
  }));
  const { error } = await sb.from("state_compliance_rules").insert(payload);
  if (error) throw new Error(error.message);
  return payload.length;
}

// ---------------------------------------------------------------------------
// Compliance Disclaimers
// ---------------------------------------------------------------------------

export async function listDisclaimers(opts?: {
  enabledOnly?: boolean;
}): Promise<ComplianceDisclaimer[]> {
  const { supabase: sb } = await getTenantClient();
  let q = sb
    .from("compliance_disclaimers")
    .select("*")
    .order("label", { ascending: true });
  if (opts?.enabledOnly) q = q.eq("enabled", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ComplianceDisclaimer[];
}

export async function upsertDisclaimer(
  row: Partial<ComplianceDisclaimer> & { label: string; text: string },
): Promise<ComplianceDisclaimer> {
  const { supabase: sb, tenantId } = await getTenantClient();
  const payload: Record<string, unknown> = {
    label: row.label,
    text: row.text,
    jurisdiction: row.jurisdiction ?? null,
    trigger: row.trigger ?? null,
    practice_area: row.practice_area ?? null,
    enabled: row.enabled ?? true,
    review_status: row.review_status ?? "unverified",
    tenant_id: tenantId,
  };
  if (row.id) payload.id = row.id;
  const { data, error } = await sb
    .from("compliance_disclaimers")
    .upsert(payload)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "upsert failed");
  return data as ComplianceDisclaimer;
}

export async function deleteDisclaimer(id: string): Promise<void> {
  const { supabase: sb } = await getTenantClient();
  const { error } = await sb
    .from("compliance_disclaimers")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Lookups for the compliance engine (lib/ads-compliance.ts)
// ---------------------------------------------------------------------------

/** Enabled state rules for the given jurisdiction codes (case-insensitive). */
export async function getRulesForJurisdictions(
  codes: string[],
): Promise<StateComplianceRule[]> {
  const wanted = codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (wanted.length === 0) return [];
  const rules = await listStateRules({ enabledOnly: true });
  return rules.filter((r) =>
    wanted.includes(r.jurisdiction_code.toUpperCase()),
  );
}

/** Enabled disclaimers that apply to the given jurisdictions or are general. */
export async function getDisclaimersForJurisdictions(
  codes: string[],
): Promise<ComplianceDisclaimer[]> {
  const wanted = codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  const all = await listDisclaimers({ enabledOnly: true });
  return all.filter((d) => {
    const j = (d.jurisdiction ?? "").trim().toUpperCase();
    if (!j || j === "GENERAL" || j === "ALL") return true;
    return wanted.includes(j);
  });
}
