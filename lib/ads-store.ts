/**
 * Supabase CRUD for the /ads section.
 *
 * Four tables — see supabase/ads_schema.sql for the schema. All access goes
 * through the service-role client; RLS exists for any future client-side use.
 */

import { getTenantClient } from "@/lib/tenant-db";

// ---------- ad_creatives ---------------------------------------------------

export type AdCreativeStatus = "draft" | "approved" | "paused" | "archived";

export interface AdCreative {
  id: string;
  name: string;
  platform: string;
  format: string | null;
  practice_area: string | null;
  headline: string | null;
  description: string | null;
  body: string | null;
  cta: string | null;
  visual_url: string | null;
  notes: string | null;
  status: AdCreativeStatus;
  compliance_score: number | null;
  compliance_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdCreativeInput {
  name: string;
  platform: string;
  format?: string | null;
  practice_area?: string | null;
  headline?: string | null;
  description?: string | null;
  body?: string | null;
  cta?: string | null;
  visual_url?: string | null;
  notes?: string | null;
  status?: AdCreativeStatus;
}

export async function listAdCreatives(): Promise<AdCreative[]> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdCreative[];
}

export async function createAdCreative(input: AdCreativeInput): Promise<AdCreative> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_creatives")
    .insert({
      ...input,
      status: input.status ?? "draft",
      tenant_id: tenantId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AdCreative;
}

export async function updateAdCreative(
  id: string,
  patch: Partial<AdCreativeInput> & { compliance_score?: number; compliance_checked_at?: string },
): Promise<AdCreative> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_creatives")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AdCreative;
}

export async function deleteAdCreative(id: string): Promise<void> {
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase.from("ad_creatives").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- negative_keywords ----------------------------------------------

export type NegativeKeywordMatchType = "exact" | "phrase" | "broad";

export interface NegativeKeyword {
  id: string;
  keyword: string;
  match_type: NegativeKeywordMatchType;
  reason: string | null;
  source: string | null;
  created_at: string;
}

export async function listNegativeKeywords(): Promise<NegativeKeyword[]> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("negative_keywords")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as NegativeKeyword[];
}

export async function createNegativeKeyword(input: {
  keyword: string;
  match_type?: NegativeKeywordMatchType;
  reason?: string | null;
  source?: string | null;
}): Promise<NegativeKeyword> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("negative_keywords")
    .insert({
      keyword: input.keyword.trim(),
      match_type: input.match_type ?? "phrase",
      reason: input.reason ?? null,
      source: input.source ?? "manual",
      tenant_id: tenantId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as NegativeKeyword;
}

export async function deleteNegativeKeyword(id: string): Promise<void> {
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase.from("negative_keywords").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- ad_compliance_checks -------------------------------------------

export interface ComplianceCheckRow {
  id: string;
  creative_id: string | null;
  ad_copy: string;
  platform: string | null;
  jurisdiction: string;
  result: unknown;
  created_at: string;
}

export async function recordComplianceCheck(input: {
  ad_copy: string;
  platform?: string | null;
  jurisdiction?: string;
  creative_id?: string | null;
  result: unknown;
}): Promise<ComplianceCheckRow> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_compliance_checks")
    .insert({
      ad_copy: input.ad_copy,
      platform: input.platform ?? null,
      jurisdiction: input.jurisdiction ?? "NY,NJ",
      creative_id: input.creative_id ?? null,
      result: input.result,
      tenant_id: tenantId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ComplianceCheckRow;
}

export async function listRecentComplianceChecks(limit = 20): Promise<ComplianceCheckRow[]> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_compliance_checks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ComplianceCheckRow[];
}

// ---------- ad_platform_accounts -------------------------------------------

export type PlatformStatus = "not_connected" | "connected" | "error";

export interface PlatformAccount {
  id: string;
  platform: string;
  display_name: string;
  status: PlatformStatus;
  account_id: string | null;
  account_name: string | null;
  metadata: unknown;
  connected_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listPlatformAccounts(): Promise<PlatformAccount[]> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_platform_accounts")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccount[];
}

// ---------- ad_audits (audit history) --------------------------------------

export interface AdAuditRow {
  id: string;
  platform: string;
  report_type: string | null;
  health_score: number | null;
  issue_count: number;
  neg_count: number;
  summary: string | null;
  result: unknown;
  created_at: string;
}

export async function recordAdAudit(input: {
  platform: string;
  report_type?: string | null;
  health_score?: number | null;
  issue_count?: number;
  neg_count?: number;
  summary?: string | null;
  result: unknown;
}): Promise<AdAuditRow> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_audits")
    .insert({
      platform: input.platform,
      report_type: input.report_type ?? null,
      health_score: input.health_score ?? null,
      issue_count: input.issue_count ?? 0,
      neg_count: input.neg_count ?? 0,
      summary: input.summary ?? null,
      result: input.result,
      tenant_id: tenantId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AdAuditRow;
}

export async function listAdAudits(limit = 25): Promise<AdAuditRow[]> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_audits")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AdAuditRow[];
}

// ---------- ad_keyword_queue (approve-before-publish negatives) -------------

export type KeywordQueueStatus = "pending" | "approved" | "rejected";

export interface KeywordQueueRow {
  id: string;
  keyword: string;
  match_type: NegativeKeywordMatchType;
  level: "account" | "campaign";
  reason: string | null;
  source: string;
  status: KeywordQueueStatus;
  decided_at: string | null;
  created_at: string;
}

export interface KeywordSuggestionInput {
  keyword: string;
  match_type?: NegativeKeywordMatchType;
  level?: "account" | "campaign";
  reason?: string | null;
  source?: string;
}

/** Queue one or more suggested negatives for approval. Skips empty keywords. */
export async function queueKeywordSuggestions(
  suggestions: KeywordSuggestionInput[],
): Promise<KeywordQueueRow[]> {
  const { supabase, tenantId } = await getTenantClient();
  const rows = suggestions
    .filter((s) => s.keyword && s.keyword.trim())
    .map((s) => ({
      keyword: s.keyword.trim(),
      match_type: s.match_type ?? "phrase",
      level: s.level ?? "campaign",
      reason: s.reason ?? null,
      source: s.source ?? "audit",
      status: "pending" as const,
      tenant_id: tenantId,
    }));
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from("ad_keyword_queue")
    .insert(rows)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as KeywordQueueRow[];
}

export async function listKeywordQueue(
  status: KeywordQueueStatus = "pending",
): Promise<KeywordQueueRow[]> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_keyword_queue")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KeywordQueueRow[];
}

/**
 * Approve or reject a queued suggestion. On approval the keyword is copied into
 * negative_keywords (source "audit"); a duplicate there is treated as success
 * so the queue item still resolves.
 */
export async function decideKeywordSuggestion(
  id: string,
  decision: "approved" | "rejected",
): Promise<KeywordQueueRow> {
  const { supabase, tenantId } = await getTenantClient();

  const { data: row, error: getErr } = await supabase
    .from("ad_keyword_queue")
    .select("*")
    .eq("id", id)
    .single();
  if (getErr) throw new Error(getErr.message);
  const item = row as KeywordQueueRow;

  if (decision === "approved") {
    const { error: insErr } = await supabase.from("negative_keywords").insert({
      keyword: item.keyword,
      match_type: item.match_type,
      reason: item.reason ?? `${item.level}-level (from audit)`,
      source: "audit",
      tenant_id: tenantId,
    });
    // A duplicate negative keyword is fine — the intent (block it) is satisfied.
    if (insErr && !/duplicate|unique/i.test(insErr.message)) {
      throw new Error(insErr.message);
    }
  }

  const { data, error } = await supabase
    .from("ad_keyword_queue")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as KeywordQueueRow;
}

// ---------- ad_economics (case value + close rate) -------------------------

export interface AdEconomicsRow {
  id: string;
  practice_area: string;
  avg_case_value: number;
  close_rate: number;
  notes: string | null;
  updated_at: string;
}

export async function listAdEconomics(): Promise<AdEconomicsRow[]> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_economics")
    .select("*")
    .order("practice_area", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdEconomicsRow[];
}

/** Upsert one practice area's economics on (tenant_id, practice_area). */
export async function upsertAdEconomics(input: {
  practice_area: string;
  avg_case_value: number;
  close_rate: number;
  notes?: string | null;
}): Promise<AdEconomicsRow> {
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("ad_economics")
    .upsert(
      {
        practice_area: input.practice_area,
        avg_case_value: input.avg_case_value,
        close_rate: input.close_rate,
        notes: input.notes ?? null,
        updated_at: new Date().toISOString(),
        tenant_id: tenantId,
      },
      { onConflict: "tenant_id,practice_area" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AdEconomicsRow;
}

export async function deleteAdEconomics(id: string): Promise<void> {
  const { supabase } = await getTenantClient();
  const { error } = await supabase.from("ad_economics").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
