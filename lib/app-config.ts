/**
 * Product-level (tenant-agnostic) branding.
 *
 * This is the SaaS product name shown in places that render BEFORE we know
 * which firm is signed in — the login screen and the browser tab title. It is
 * deliberately NOT the firm name; the firm name comes per-tenant from
 * tenant_settings via getTenantConfig() / getFirmContext().
 *
 * Override per deployment with NEXT_PUBLIC_APP_NAME. Safe to import from both
 * server and client code (NEXT_PUBLIC_ vars are inlined at build).
 */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Huraqan";
