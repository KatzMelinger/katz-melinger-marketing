-- ============================================================================
-- Multi-tenancy — Phase 4: tenant isolation for site_pages (cluster map).
-- site_pages was keyed by a global UNIQUE(url); two firms can have the same
-- path, so the conflict target moves to (tenant_id, url). The crawler/ingest
-- libs upsert on (tenant_id, url); reads (list, link-verify, content-overlap)
-- scope by tenant. Idempotent.
-- ============================================================================
alter table public.site_pages drop constraint if exists site_pages_url_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_pages_tenant_url_key'
  ) then
    alter table public.site_pages
      add constraint site_pages_tenant_url_key unique (tenant_id, url);
  end if;
end $$;

alter table public.site_pages enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='site_pages' loop
    execute format('drop policy if exists %I on public.site_pages', p);
  end loop;
  create policy "tenant rw site_pages" on public.site_pages for all to authenticated
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());
end $$;
