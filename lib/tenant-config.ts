/**
 * Per-tenant configuration reader (Phase 2).
 *
 * Single place that resolves "what are this tenant's settings?" — SEO
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
import { resolveTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant-context";
import { getGscSiteUrl } from "@/lib/gsc-site-url";

/**
 * Default primary domain for SEO data when a tenant hasn't set one. Also used
 * as a provider-neutral sentinel by the SEO intelligence + cannibalization
 * helpers: functions default their `domain` arg to this, then swap in the
 * resolved per-tenant domain, so callers passing an explicit competitor domain
 * are unaffected.
 */
export const DEFAULT_SEO_DOMAIN = "katzmelinger.com";
import {
  ALL_KM_PILLARS,
  KM_SYSTEM_PROMPT,
  NEUTRAL_SYSTEM_PROMPT,
  type KMPillar,
} from "@/lib/km-content-system";

export type PracticeAreaOption = { id: string; label: string };

export type TenantConfig = {
  tenantId: string;
  seoDomain: string;
  gscSiteUrl: string;
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  firmWebsite: string;
  targetGeography: string;
  /** Attribution-ready spokesperson, e.g. "Jane Doe, Partner at Doe Law LLP".
   *  Used for PR pitches / quotes. Empty when not configured (non-default firms). */
  firmSpokesperson: string;
  /** Per-tenant brand color (hex). Always resolved — defaults to the product blue. */
  brandColor: string;
  /** Optional logo URL shown in the sidebar wordmark slot. */
  logoUrl: string | null;
  /** Chosen email-distribution provider id, or null = registry default. */
  emailProvider: string | null;
  /** null when the tenant hasn't customized — callers use their own default. */
  practiceAreas: PracticeAreaOption[] | null;
  /** Always resolved: tenant value or the code-defined ALL_KM_PILLARS. */
  pillars: KMPillar[];
  /** Always resolved: tenant value or the code-defined KM_SYSTEM_PROMPT. */
  systemPrompt: string;
  /** Ayrshare per-profile key (Business multi-account); null = use the
   *  account-level key alone. */
  ayrshareProfileKey: string | null;
};

// Hardcoded firm-identity fallbacks. These are KM-SPECIFIC and must ONLY apply
// to the default Katz Melinger tenant — any other tenant that hasn't filled in
// its tenant_settings gets blanks, never KM's name/address/phone/email. The
// content prompts are instructed never to fabricate contact details, so blank
// is safe; inheriting KM's would be a cross-firm data leak. (Mirrors
// DEFAULT_CONTACT in lib/firm-context.ts.)
const KM_FALLBACK = {
  firmName: "Katz Melinger PLLC",
  firmAddress: "370 Lexington Avenue, Suite 1512, New York, NY 10017",
  firmPhone: "(212) 460-0047",
  firmEmail: "info@katzmelinger.com",
  firmWebsite: "www.KatzMelinger.com",
  targetGeography: "New York and New Jersey",
  firmSpokesperson: "Kenneth Katz, Partner at Katz Melinger PLLC",
};

const EMPTY_FALLBACK = {
  firmName: "",
  firmAddress: "",
  firmPhone: "",
  firmEmail: "",
  firmWebsite: "",
  targetGeography: "",
  firmSpokesperson: "",
};

type SettingsRow = {
  seo_domain: string | null;
  gsc_site_url: string | null;
  firm_name: string | null;
  firm_address: string | null;
  firm_phone: string | null;
  firm_email: string | null;
  firm_website: string | null;
  target_geography: string | null;
  firm_spokesperson: string | null;
  brand_primary_color: string | null;
  logo_url: string | null;
  email_provider: string | null;
  practice_areas: PracticeAreaOption[] | null;
  pillars: KMPillar[] | null;
  system_prompt: string | null;
  ayrshare_profile_key: string | null;
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

  // KM-specific identity defaults apply only to the default tenant; every other
  // tenant falls back to blanks so it can never inherit KM's firm details.
  const fb = id === DEFAULT_TENANT_ID ? KM_FALLBACK : EMPTY_FALLBACK;

  return {
    tenantId: id,
    seoDomain: row?.seo_domain || DEFAULT_SEO_DOMAIN,
    gscSiteUrl: row?.gsc_site_url || getGscSiteUrl(),
    firmName: row?.firm_name || fb.firmName,
    firmAddress: row?.firm_address || fb.firmAddress,
    firmPhone: row?.firm_phone || fb.firmPhone,
    firmEmail: row?.firm_email || fb.firmEmail,
    firmWebsite: row?.firm_website || fb.firmWebsite,
    targetGeography: row?.target_geography || fb.targetGeography,
    firmSpokesperson: row?.firm_spokesperson || fb.firmSpokesperson,
    brandColor: row?.brand_primary_color || "#116AB2",
    logoUrl: row?.logo_url || null,
    emailProvider: row?.email_provider || null,
    practiceAreas:
      Array.isArray(row?.practice_areas) && row!.practice_areas!.length > 0
        ? row!.practice_areas!
        : null,
    pillars:
      Array.isArray(row?.pillars) && row!.pillars!.length > 0
        ? row!.pillars!
        : id === DEFAULT_TENANT_ID
          ? ALL_KM_PILLARS
          : [],
    systemPrompt:
      typeof row?.system_prompt === "string" && row.system_prompt.trim()
        ? row.system_prompt
        : id === DEFAULT_TENANT_ID
          ? KM_SYSTEM_PROMPT
          : NEUTRAL_SYSTEM_PROMPT,
    ayrshareProfileKey:
      typeof row?.ayrshare_profile_key === "string" && row.ayrshare_profile_key.trim()
        ? row.ayrshare_profile_key
        : null,
  };
}

/** Lowercase + strip protocol/www/path so hosts compare cleanly. */
function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/:].*$/, "");
}

/**
 * Reverse lookup: which tenant owns a given site host? Used by session-less
 * public endpoints (e.g. /api/ai-bots/ingest) that only know which domain was
 * crawled. Matches the host against each tenant's seo_domain / gsc_site_url
 * / firm_website. Falls back to the default tenant when nothing matches, so
 * single-tenant behavior is unchanged.
 */
export async function resolveTenantIdByDomain(
  host: string | null | undefined,
): Promise<string> {
  if (!host) return DEFAULT_TENANT_ID;
  const target = normalizeHost(host);
  if (!target) return DEFAULT_TENANT_ID;
  const sb = getSupabaseServer();
  if (!sb) return DEFAULT_TENANT_ID;
  try {
    const { data } = await sb
      .from("tenant_settings")
      .select("tenant_id, seo_domain, gsc_site_url, firm_website");
    for (const row of data ?? []) {
      const candidates = [
        row.seo_domain,
        row.gsc_site_url,
        row.firm_website,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);
      if (candidates.some((c) => normalizeHost(c) === target)) {
        return row.tenant_id as string;
      }
    }
  } catch {
    /* table missing / unreachable — fall back */
  }
  return DEFAULT_TENANT_ID;
}
