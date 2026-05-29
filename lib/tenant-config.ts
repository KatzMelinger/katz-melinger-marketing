/**
 * Per-tenant configuration reader (Phase 2).
 *
 * Single place that resolves "what are this tenant's settings?" — Semrush
 * domain, GSC site URL, firm contact, content pillars, practice areas, and
 * the content-generation system prompt. Reads the tenant_settings row and
 * falls back to the existing hardcoded constants whenever a field is null,
 * so the default Katz Melinger tenant behaves exactly as before.
 *
 * Consumers should import from here instead of the hardcoded constants, so
 * that when Phase 4 makes resolveTenantId() return a real per-request tenant,
 * everything becomes per-tenant with no further changes.
 */

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { SEMRUSH_DOMAIN, SEMRUSH_DATABASE } from "@/lib/semrush";
import { getGscSiteUrl } from "@/lib/gsc-site-url";
import {
  ALL_KM_PILLARS,
  KM_SYSTEM_PROMPT,
  type KMPillar,
} from "@/lib/km-content-system";

export type PracticeAreaOption = { id: string; label: string };

export type TenantConfig = {
  tenantId: string;
  semrushDomain: string;
  semrushDatabase: string;
  gscSiteUrl: string;
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  firmWebsite: string;
  targetGeography: string;
  /** null when the tenant hasn't customized — callers use their own default. */
  practiceAreas: PracticeAreaOption[] | null;
  /** Always resolved: tenant value or the code-defined ALL_KM_PILLARS. */
  pillars: KMPillar[];
  /** Always resolved: tenant value or the code-defined KM_SYSTEM_PROMPT. */
  systemPrompt: string;
};

// Hardcoded fallbacks for the firm-contact fields (mirror DEFAULT_CONTACT in
// lib/firm-context.ts). Kept here because tenant-config is the canonical
// config source going forward.
const FALLBACK = {
  firmName: "Katz Melinger PLLC",
  firmAddress: "370 Lexington Avenue, Suite 1512, New York, NY 10017",
  firmPhone: "(212) 460-0047",
  firmEmail: "info@katzmelinger.com",
  firmWebsite: "www.KatzMelinger.com",
  targetGeography: "New York and New Jersey",
};

type SettingsRow = {
  semrush_domain: string | null;
  semrush_database: string | null;
  gsc_site_url: string | null;
  firm_name: string | null;
  firm_address: string | null;
  firm_phone: string | null;
  firm_email: string | null;
  firm_website: string | null;
  target_geography: string | null;
  practice_areas: PracticeAreaOption[] | null;
  pillars: KMPillar[] | null;
  system_prompt: string | null;
};

export async function getTenantConfig(tenantId?: string): Promise<TenantConfig> {
  const id = tenantId ?? (await resolveTenantId());
  let row: SettingsRow | null = null;
  const sb = getSupabaseServer();
  if (sb) {
    try {
      const { data } = await sb
        .from("tenant_settings")
        .select("*")
        .eq("tenant_id", id)
        .maybeSingle();
      row = (data as SettingsRow | null) ?? null;
    } catch {
      row = null; // table not migrated yet — fall back to constants
    }
  }

  return {
    tenantId: id,
    semrushDomain: row?.semrush_domain || SEMRUSH_DOMAIN,
    semrushDatabase: row?.semrush_database || SEMRUSH_DATABASE,
    gscSiteUrl: row?.gsc_site_url || getGscSiteUrl(),
    firmName: row?.firm_name || FALLBACK.firmName,
    firmAddress: row?.firm_address || FALLBACK.firmAddress,
    firmPhone: row?.firm_phone || FALLBACK.firmPhone,
    firmEmail: row?.firm_email || FALLBACK.firmEmail,
    firmWebsite: row?.firm_website || FALLBACK.firmWebsite,
    targetGeography: row?.target_geography || FALLBACK.targetGeography,
    practiceAreas:
      Array.isArray(row?.practice_areas) && row!.practice_areas!.length > 0
        ? row!.practice_areas!
        : null,
    pillars:
      Array.isArray(row?.pillars) && row!.pillars!.length > 0
        ? row!.pillars!
        : ALL_KM_PILLARS,
    systemPrompt:
      typeof row?.system_prompt === "string" && row.system_prompt.trim()
        ? row.system_prompt
        : KM_SYSTEM_PROMPT,
  };
}
