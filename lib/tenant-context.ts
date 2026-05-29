/**
 * Tenant context — single source of truth for "which tenant is this request?"
 *
 * PHASE 1 (now): always returns the default Katz Melinger tenant. The app is
 * still effectively single-tenant; this just centralizes the id so Phases 2-4
 * can swap the resolution logic in ONE place instead of touching every route.
 *
 * PHASE 4 (later): resolveTenantId() will read the caller's tenant from their
 * session / app_users row (recommended model: user → one tenant) and RLS will
 * enforce isolation. Until then everything reads/writes the default tenant via
 * the column DEFAULT set in multitenancy_phase1_schema.sql.
 */

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_TENANT_SLUG = "katz-melinger";

/**
 * Returns the tenant id for the current request. Phase 1 stub — always the
 * default tenant. Do NOT scatter the literal UUID around the codebase; import
 * this so Phase 4 can replace the body without a hunt-and-replace.
 */
export async function resolveTenantId(): Promise<string> {
  // TODO(phase4): resolve from session → app_users.tenant_id.
  return DEFAULT_TENANT_ID;
}
