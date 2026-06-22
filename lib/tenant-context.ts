/**
 * Tenant context — single source of truth for "which tenant is this request?"
 *
 * Resolves the caller's tenant from their session → app_users.tenant_id
 * (model: user → one tenant). Falls back to the default Katz Melinger tenant
 * when there's no session (e.g. cron / background jobs) or no app_users row,
 * which keeps single-tenant behavior identical for existing users.
 *
 * SECURITY: the default fallback means an UNAUTHENTICATED caller would resolve
 * to the KM tenant. That's only safe because the auth proxy (proxy.ts) now
 * default-denies /api/* without a session, so anonymous requests never reach a
 * route that calls this. Server Components must forward the session cookie on
 * internal /api fetches (use serverFetch from lib/request-origin.ts) so the
 * logged-in user — and thus their real tenant — is visible here.
 *
 * RLS IS enforced for routes that use the authenticated client (getTenantDb /
 * getTenantClient). Routes that use the service-role client bypass RLS, so they
 * must still scope reads and stamp writes with this tenant id.
 *
 * TODO (when tenant onboarding lands): once every real user has an app_users
 * row, make an authenticated-but-tenantless user fail closed instead of
 * inheriting the KM tenant.
 */

import { getSupabaseRouteClient } from "@/lib/supabase-route";

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_TENANT_SLUG = "katz-melinger";

/**
 * Returns the tenant id for the current request: the logged-in user's
 * app_users.tenant_id, or the default tenant when unauthenticated / no row.
 * Safe to call outside request scope — any failure falls back to the default.
 */
export async function resolveTenantId(): Promise<string> {
  try {
    const supabase = await getSupabaseRouteClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_TENANT_ID;
    const { data } = await supabase
      .from("app_users")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();
    return (data?.tenant_id as string | undefined) ?? DEFAULT_TENANT_ID;
  } catch {
    return DEFAULT_TENANT_ID;
  }
}
