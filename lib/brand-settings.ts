/**
 * Shared by /api/brand-voice/settings and the rule history Restore (Task 24).
 *
 * Firm-IDENTITY fields live canonically in tenant_settings (read by the sidebar,
 * getTenantConfig, and every per-tenant feature). They are ALSO mirrored in
 * brand_voice_settings for backward compatibility with getFirmContext. Any
 * identity key saved through either path is written to its tenant_settings
 * column too.
 */
import { getSupabaseAdmin } from "./supabase-server";

export const IDENTITY_TO_COLUMN: Record<string, string> = {
  firmName: "firm_name",
  firmAddress: "firm_address",
  firmPhone: "firm_phone",
  firmEmail: "firm_email",
  firmWebsite: "firm_website",
  targetGeography: "target_geography",
  firmSpokesperson: "firm_spokesperson",
  brandPrimaryColor: "brand_primary_color",
  logoUrl: "logo_url",
};

/** Put one setting back to an earlier value (service role, tenant-scoped). */
export async function writeBrandSetting(tenantId: string, key: string, value: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("brand_voice_settings")
    .upsert({ tenant_id: tenantId, key, value, updated_at: now }, { onConflict: "tenant_id,key" });
  if (error) throw new Error(error.message);
  const col = IDENTITY_TO_COLUMN[key];
  if (col) {
    const { error: ts } = await sb
      .from("tenant_settings")
      .upsert({ tenant_id: tenantId, [col]: value, updated_at: now }, { onConflict: "tenant_id" });
    if (ts) console.error("[brand-settings] tenant_settings sync failed:", ts.message);
  }
}
