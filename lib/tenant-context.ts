/**
 * Tenant context — single source of truth for "which tenant is this request?"
 *
 * Resolves the caller's tenant from their session → app_users.tenant_id
 * (model: user → one tenant). Falls back to the default Katz Melinger tenant
 * when there's no session (e.g. cron / background jobs) or no app_users row,
 * which keeps single-tenant behavior identical for existing users.
 *
 * NOTE: data isolation is NOT yet enforced at the DB layer — server queries
 * use the service-role client, which bypasses RLS. Callers must scope reads
 * and stamp writes with this tenant id until the enforcement layer lands.
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
