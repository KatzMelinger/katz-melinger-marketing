-- ============================================================================
-- Multi-tenancy — Phase 4 module: enforce tenant isolation on seo_keywords.
-- ============================================================================
-- Same zero-window pattern as seo_opportunities:
--   Step A (this file): add (tenant_id, keyword) unique ALONGSIDE the existing
--   (keyword) unique, and flip RLS from permissive to tenant-scoped. Safe before
--   the code ships (deployed code is service-role, which bypasses RLS).
--   Step B (..._seo_keywords_dropunique.sql): drop the (keyword)-only unique
--   AFTER the tenant-aware code is deployed.
-- Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seo_keywords_tenant_keyword_key') then
    alter table public.seo_keywords
      add constraint seo_keywords_tenant_keyword_key unique (tenant_id, keyword);
  end if;
end $$;

alter table public.seo_keywords enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='seo_keywords' loop
    execute format('drop policy if exists %I on public.seo_keywords', p);
  end loop;
end $$;
create policy "tenant rw seo_keywords" on public.seo_keywords
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
