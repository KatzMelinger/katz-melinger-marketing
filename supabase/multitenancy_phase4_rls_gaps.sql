-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project.
--
-- Before you click Run: confirm the project ref in the Supabase dashboard URL
-- matches the ref in .env.local's NEXT_PUBLIC_SUPABASE_URL.
-- ============================================================================

-- ============================================================================
-- Multi-tenancy — Phase 4 (gap fix): tenant-scoped RLS for three tables that
-- carry a tenant_id column but were never picked up by a Phase 4 migration, so
-- they still ship the permissive base-schema policy (`using (true)`). They are
-- safe today only because the app reaches them via the service-role client;
-- the moment a module moves to the authenticated/user-JWT client they would
-- leak cross-tenant. Flip them to the same tenant-scoped policy as the rest.
--
-- Tables: authority_snapshots, seo_rank_snapshots, seo_keyword_exclusions.
-- Tenant is resolved by public.current_tenant_id() (app_users lookup on
-- auth.uid(); defined in multitenancy_phase4_rls.sql). Idempotent.
-- ============================================================================

do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'authority_snapshots',
    'seo_rank_snapshots',
    'seo_keyword_exclusions'
  ]
  loop
    -- Skip cleanly if the table doesn't exist in this project.
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skip %, table not present', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- Drop every existing policy (including the permissive base-schema one).
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;

    -- Recreate the standard tenant-scoped read/write policy.
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (tenant_id = public.current_tenant_id()) '
      || 'with check (tenant_id = public.current_tenant_id())',
      'tenant rw ' || t, t
    );
  end loop;
end $$;
