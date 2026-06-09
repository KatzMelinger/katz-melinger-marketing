-- ============================================================================
-- Multi-tenancy — Phase 4b: DB-enforced tenant isolation (RLS).
-- ============================================================================
-- VALIDATED design (see scripts/mig-rls-test.mjs, run in a rolled-back txn):
-- a user in tenant A sees ONLY tenant-A rows, B sees only B's.
--
-- IMPORTANT ROLLOUT NOTE:
--   The app currently reads/writes via the SERVICE-ROLE client, which BYPASSES
--   RLS. So enabling these policies changes NOTHING for service-role paths and
--   provides REAL enforcement only once a module's data access is moved to the
--   authenticated (user-JWT) client. Therefore:
--     * The current_tenant_id() function below is safe to apply now.
--     * The per-table policy block should be applied PER-MODULE, in lockstep
--       with switching that module's routes to the authenticated client and
--       stamping tenant_id on writes. Flipping all tables up front is all risk,
--       no benefit (data still flows through service-role).
--
-- Idempotent.
-- ============================================================================

-- Resolver: the caller's tenant. SECURITY DEFINER so it reads app_users past
-- RLS (avoids recursion when used inside app_users' own policy).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.app_users where user_id = auth.uid()
$$;

-- ----------------------------------------------------------------------------
-- PER-MODULE POLICY FLIP (apply a table at a time during the code rollout).
-- Converts a table from the permissive "any authenticated" policy to
-- tenant-scoped. Replace <TABLE> and run, or run the DO block to do all
-- tenant_id-bearing tables at once ONLY once every module is converted.
-- ----------------------------------------------------------------------------
-- do $$
-- declare t text;
-- begin
--   for t in
--     select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--     join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
--     where n.nspname='public' and c.relkind='r'
--   loop
--     execute format('alter table public.%I enable row level security', t);
--     -- drop whatever permissive policies exist
--     execute (select string_agg(format('drop policy if exists %I on public.%I;', polname, t), ' ')
--              from pg_policies where schemaname='public' and tablename=t);
--     execute format($f$create policy "tenant read %1$s" on public.%1$I for select to authenticated
--                       using (tenant_id = public.current_tenant_id())$f$, t);
--     execute format($f$create policy "tenant write %1$s" on public.%1$I for all to authenticated
--                       using (tenant_id = public.current_tenant_id())
--                       with check (tenant_id = public.current_tenant_id())$f$, t);
--   end loop;
--   -- the tenants table keys on id, not tenant_id:
--   execute 'alter table public.tenants enable row level security';
--   drop policy if exists "tenant self" on public.tenants;
--   create policy "tenant self" on public.tenants for select to authenticated
--     using (id = public.current_tenant_id());
-- end $$;
