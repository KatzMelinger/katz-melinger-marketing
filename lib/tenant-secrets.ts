/**
 * Per-tenant integration credentials (Workstream B5).
 *
 * Server-only access to the tenant_secrets table (service-role; the table has
 * RLS on with no policies, so the browser can never read it). Lets each firm
 * supply its OWN credentials for per-firm integrations (Google service account,
 * CallRail, etc.) instead of everyone sharing one env var.
 *
 * Resolution order in getTenantSecret(key):
 *   1. the firm's stored secret (tenant_secrets row), if present
 *   2. for the DEFAULT (platform) tenant only → the process.env[key] fallback
 *   3. otherwise undefined
 *
 * Step 2 is gated to the default tenant on purpose: a non-default firm must
 * never silently fall back to the platform's KM credentials (that would query
 * KM's Google/CallRail data). Shared platform keys (Anthropic, DataForSEO) are
 * NOT stored here — they stay in env and are read directly.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant-context";

export async function getTenantSecret(
  key: string,
  tenantId?: string,
): Promise<string | undefined> {
  const tid = tenantId ?? (await resolveTenantId());

  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("tenant_secrets")
      .select("value")
      .eq("tenant_id", tid)
      .eq("key", key)
      .maybeSingle();
    const stored = typeof data?.value === "string" ? data.value.trim() : "";
    if (stored) return stored;
  } catch {
    // table missing / unavailable — fall through to env (default tenant only)
  }

  // Only the platform/default tenant inherits the env-var credential.
  if (tid === DEFAULT_TENANT_ID) {
    const env = process.env[key]?.trim();
    return env || undefined;
  }
  return undefined;
}

/** Write (or clear) a per-tenant secret. Pass an empty value to delete it. */
export async function setTenantSecret(
  key: string,
  value: string,
  tenantId?: string,
): Promise<void> {
  const tid = tenantId ?? (await resolveTenantId());
  const sb = getSupabaseAdmin();
  if (!value.trim()) {
    await sb.from("tenant_secrets").delete().eq("tenant_id", tid).eq("key", key);
    return;
  }
  await sb.from("tenant_secrets").upsert(
    { tenant_id: tid, key, value, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,key" },
  );
}

/** Which per-tenant secret keys a firm can configure (for the settings UI). */
export const TENANT_SECRET_KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "CALLRAIL_API_KEY",
  "CALLRAIL_ACCOUNT_ID",
] as const;
export type TenantSecretKey = (typeof TENANT_SECRET_KEYS)[number];
