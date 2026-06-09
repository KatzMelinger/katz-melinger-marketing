-- ============================================================================
-- Multi-tenancy — Phase 4: tenant isolation for google_oauth_tokens.
-- Was keyed by a global UNIQUE(purpose) (one token per purpose, app-wide);
-- each firm connects its own Google account, so the conflict target moves to
-- (tenant_id, purpose). google-oauth.ts upserts on (tenant_id, purpose) and
-- scopes reads/deletes by tenant (tenantId param defaults to resolveTenantId,
-- so request callers use the session tenant and cron callers can pass explicit).
-- Idempotent.
-- ============================================================================
alter table public.google_oauth_tokens drop constraint if exists google_oauth_tokens_purpose_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'google_oauth_tokens_tenant_purpose_key'
  ) then
    alter table public.google_oauth_tokens
      add constraint google_oauth_tokens_tenant_purpose_key unique (tenant_id, purpose);
  end if;
end $$;

alter table public.google_oauth_tokens enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='google_oauth_tokens' loop
    execute format('drop policy if exists %I on public.google_oauth_tokens', p);
  end loop;
  create policy "tenant rw google_oauth_tokens" on public.google_oauth_tokens for all to authenticated
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());
end $$;
