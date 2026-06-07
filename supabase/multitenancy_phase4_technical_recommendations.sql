-- ============================================================================
-- Multi-tenancy — Phase 4 module: tenant-scoped RLS for Technical SEO runs
-- and Recommendations history. Both keyed by `id`, so RLS flip only. Idempotent.
-- ============================================================================
do $$
declare t text; p text;
begin
  foreach t in array array['technical_seo_runs','recommendations_history'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
