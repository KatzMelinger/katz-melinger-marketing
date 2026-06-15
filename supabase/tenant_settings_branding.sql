-- ============================================================================
-- tenant_settings branding columns — per-tenant white-label look.
-- ============================================================================
--   brand_primary_color : hex like "#185FA5"; drives the --brand CSS variable.
--   logo_url            : optional logo shown in the sidebar wordmark slot.
-- Idempotent; safe to re-run. KM (default tenant) is left null → falls back to
-- the built-in default color (#185FA5) and its firm-name wordmark.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists brand_primary_color text;

alter table public.tenant_settings
  add column if not exists logo_url text;
