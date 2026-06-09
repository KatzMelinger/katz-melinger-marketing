-- ============================================================================
-- Multi-tenancy — Phase 4 module: tenant-scoped RLS for SEO Disavow.
-- ============================================================================
-- seo_disavow_actions was keyed by `domain` alone (PK); repoint to
-- (tenant_id, domain) so each firm has its own disavow list (the upsert uses
-- onConflict "tenant_id,domain"). Then flip RLS to tenant-scoped. Idempotent.
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from pg_constraint con join pg_class cl on cl.oid = con.conrelid
    where cl.relname = 'seo_disavow_actions' and con.contype = 'p'
      and pg_get_constraintdef(con.oid) = 'PRIMARY KEY (tenant_id, domain)'
  ) then
    alter table public.seo_disavow_actions drop constraint if exists seo_disavow_actions_pkey;
    alter table public.seo_disavow_actions add primary key (tenant_id, domain);
  end if;
end $$;

alter table public.seo_disavow_actions enable row level security;
do $$ declare p text; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='seo_disavow_actions' loop
    execute format('drop policy if exists %I on public.seo_disavow_actions', p);
  end loop;
end $$;
create policy "tenant rw seo_disavow_actions" on public.seo_disavow_actions
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
