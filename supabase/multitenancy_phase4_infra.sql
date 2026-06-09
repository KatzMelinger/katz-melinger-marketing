-- ============================================================================
-- Multi-tenancy — Phase 4: tighten RLS on the infra tables app_users +
-- tenant_settings. Both currently have permissive USING(true) policies, so any
-- authenticated user can read every firm's user list / settings (and write any
-- firm's settings). Scope them to the caller's own tenant.
--
-- SAFE re: recursion — current_tenant_id() is SECURITY DEFINER, so it reads
-- app_users bypassing RLS; referencing it inside the app_users policy does NOT
-- recurse. A user's own row is always in their own tenant, so self-reads (which
-- power getCurrentUser/resolveTenantId) still pass. app_users WRITES stay
-- service-role only (admin invite flow) — no authenticated write policy added.
-- Idempotent.
-- ============================================================================
alter table public.app_users enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='app_users' loop
    execute format('drop policy if exists %I on public.app_users', p);
  end loop;
  create policy "tenant read app_users" on public.app_users for select to authenticated
    using (tenant_id = public.current_tenant_id());
end $$;

alter table public.tenant_settings enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='tenant_settings' loop
    execute format('drop policy if exists %I on public.tenant_settings', p);
  end loop;
  create policy "tenant rw tenant_settings" on public.tenant_settings for all to authenticated
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());
end $$;
