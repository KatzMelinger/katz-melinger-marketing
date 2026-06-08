-- ============================================================================
-- Multi-tenancy — Phase 4 cluster (1/3): tenant-scoped RLS for AEO.
-- ============================================================================
-- aeo_prompts / aeo_responses / aeo_runs / aeo_targets are all id-keyed.
-- aeo_targets additionally had UNIQUE (type, domain) which would stop two firms
-- tracking the same target — repoint it to (tenant_id, type, domain). Then flip
-- RLS to tenant-scoped on all four. Idempotent.
-- ============================================================================

do $$
declare cn text;
begin
  -- drop whatever unique constraint is currently on (type, domain), by definition
  select con.conname into cn
  from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace
  where cl.relname='aeo_targets' and n.nspname='public' and con.contype='u'
    and pg_get_constraintdef(con.oid)='UNIQUE (type, domain)';
  if cn is not null then execute format('alter table public.aeo_targets drop constraint %I', cn); end if;

  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='aeo_targets' and con.contype='u'
      and pg_get_constraintdef(con.oid)='UNIQUE (tenant_id, type, domain)') then
    alter table public.aeo_targets add constraint aeo_targets_tenant_type_domain_key unique (tenant_id, type, domain);
  end if;
end $$;

do $$
declare t text; p text;
begin
  foreach t in array array['aeo_prompts','aeo_responses','aeo_runs','aeo_targets'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
