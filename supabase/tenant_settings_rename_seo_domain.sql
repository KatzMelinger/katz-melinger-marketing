-- ============================================================================
-- Rename tenant_settings.semrush_domain → seo_domain (provider-neutral).
-- ============================================================================
-- The column holds the firm's own domain for SEO data and feeds BOTH SEMrush
-- and DataForSEO — it was never a Semrush-specific value. Renamed to match the
-- DataForSEO direction. (semrush_database stays — it IS SEMrush-specific.)
-- Idempotent: only renames if the old column still exists and the new one does not.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenant_settings'
      and column_name = 'semrush_domain'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenant_settings'
      and column_name = 'seo_domain'
  ) then
    alter table public.tenant_settings rename column semrush_domain to seo_domain;
  end if;
end $$;
