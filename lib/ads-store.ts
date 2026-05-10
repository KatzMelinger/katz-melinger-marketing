/**
 * Supabase CRUD for the /ads section.
 *
 * Four tables — see supabase/ads_schema.sql for the schema. All access goes
 * through the service-role client; RLS exists for any future client-side use.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";

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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdCreative[];
}

export async function createAdCreative(input: AdCreativeInput): Promise<AdCreative> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ad_creatives")
    .insert({
      ...input,
      status: input.status ?? "draft",
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
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("negative_keywords")
    .insert({
      keyword: input.keyword.trim(),
      match_type: input.match_type ?? "phrase",
      reason: input.reason ?? null,
      source: input.source ?? "manual",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as NegativeKeyword;
}

export async function deleteNegativeKeyword(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ad_compliance_checks")
    .insert({
      ad_copy: input.ad_copy,
      platform: input.platform ?? null,
      jurisdiction: input.jurisdiction ?? "NY,NJ",
      creative_id: input.creative_id ?? null,
      result: input.result,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ComplianceCheckRow;
}

export async function listRecentComplianceChecks(limit = 20): Promise<ComplianceCheckRow[]> {
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ad_platform_accounts")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccount[];
}
