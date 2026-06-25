/**
 * Readability thresholds — resolve + CRUD, always rooted in brand voice.
 *
 * The threshold BASE comes from the firm's brand voice (deriveThresholdsFromBrandVoice).
 * The readability_thresholds row stores only the metrics a human has explicitly
 * overridden, so any metric left alone always tracks brand voice — if the firm's
 * voice changes (more formal, more concise), the unedited bands move with it.
 *
 * Tenant-scoped: reads auto-scope via RLS (getTenantClient); the *ForTenant
 * variant takes an explicit client + tenantId for admin/background contexts
 * (e.g. analyzeDraft via after()).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getTenantClient } from "@/lib/tenant-db";
import {
  mergeThresholds,
  type MetricThreshold,
  type ReadabilityMetric,
  type ReadabilityThresholds,
} from "./config";
import {
  deriveThresholdsFromBrandVoice,
  registerFor,
  type BrandVoiceSignals,
  type Register,
} from "./brand-voice-thresholds";

type StoredConfig = Partial<
  Record<ReadabilityMetric, { green?: number; amber?: number } | null>
>;

const METRIC_KEYS: ReadabilityMetric[] = [
  "longSentenceWords",
  "longParagraphWords",
  "passiveVoicePct",
  "transitionWordPct",
  "consecutiveOpeners",
  "subheadingGapWords",
  "fkGradeLevel",
];

/** Read the latest brand-voice signals for a tenant (null if none / on error). */
async function loadBrandVoiceSignals(
  supabase: SupabaseClient,
  tenantId?: string,
): Promise<BrandVoiceSignals | null> {
  let query = supabase
    .from("brand_voice_profiles")
    .select("tone, style_preferences")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const row = data as { tone?: unknown; style_preferences?: unknown };
  return {
    tone: Array.isArray(row.tone) ? row.tone.map(String) : [],
    stylePreferences: Array.isArray(row.style_preferences)
      ? row.style_preferences.map(String)
      : [],
  };
}

async function resolve(
  supabase: SupabaseClient,
  tenantId?: string,
): Promise<{ thresholds: ReadabilityThresholds; base: ReadabilityThresholds; register: Register }> {
  const [signals, configRes] = await Promise.all([
    loadBrandVoiceSignals(supabase, tenantId),
    (tenantId
      ? supabase.from("readability_thresholds").select("config").eq("tenant_id", tenantId)
      : supabase.from("readability_thresholds").select("config")
    ).maybeSingle(),
  ]);
  const base = deriveThresholdsFromBrandVoice(signals);
  const overrides = (configRes.data?.config ?? null) as StoredConfig | null;
  return {
    thresholds: mergeThresholds(overrides, base),
    base,
    register: registerFor(signals),
  };
}

/** Resolved thresholds for the current tenant (brand-voice base + overrides). */
export async function getThresholds(): Promise<ReadabilityThresholds> {
  try {
    const { supabase } = await getTenantClient();
    return (await resolve(supabase)).thresholds;
  } catch (err) {
    console.warn("[readability] getThresholds failed, using brand-voice default:", err);
    return deriveThresholdsFromBrandVoice(null);
  }
}

/** Resolved thresholds + brand-voice base + register, for the standards editor. */
export async function getThresholdsDetail(): Promise<{
  thresholds: ReadabilityThresholds;
  base: ReadabilityThresholds;
  register: Register;
}> {
  const { supabase } = await getTenantClient();
  return resolve(supabase);
}

/**
 * Resolve thresholds for an explicit tenant using a caller-supplied client.
 * For background / admin contexts that hold a service-role client + tenantId.
 */
export async function getThresholdsForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ReadabilityThresholds> {
  try {
    return (await resolve(supabase, tenantId)).thresholds;
  } catch (err) {
    console.warn("[readability] getThresholdsForTenant failed, using brand-voice default:", err);
    return deriveThresholdsFromBrandVoice(null);
  }
}

function sameBand(a: MetricThreshold, b: MetricThreshold): boolean {
  return a.green === b.green && a.amber === b.amber;
}

/**
 * Persist explicit edits as a SPARSE override of the brand-voice base. Any
 * metric whose desired value equals the brand-voice base is dropped from the
 * stored config, so it keeps following brand voice. Returns the new resolved set.
 */
export async function saveThresholds(
  patch: Partial<Record<ReadabilityMetric, { green?: number; amber?: number }>>,
): Promise<ReadabilityThresholds> {
  const { supabase, tenantId } = await getTenantClient();
  const { thresholds: current, base } = await resolve(supabase, tenantId);

  // The desired full set = current resolved with the patch applied on top.
  const desired = mergeThresholds(patch as StoredConfig, current);

  // Store only metrics that differ from the brand-voice base.
  const overrides: StoredConfig = {};
  for (const key of METRIC_KEYS) {
    if (!sameBand(desired[key], base[key])) {
      overrides[key] = { green: desired[key].green, amber: desired[key].amber };
    }
  }

  const { error } = await supabase
    .from("readability_thresholds")
    .upsert(
      { tenant_id: tenantId, config: overrides, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    );
  if (error) throw new Error(error.message);
  return mergeThresholds(overrides, base);
}

/** Clear overrides; thresholds revert to the brand-voice base. */
export async function resetThresholds(): Promise<ReadabilityThresholds> {
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase
    .from("readability_thresholds")
    .delete()
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  const { base } = await resolve(supabase, tenantId);
  return base;
}
