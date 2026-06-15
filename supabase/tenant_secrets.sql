-- ============================================================================
-- tenant_secrets — per-tenant integration credentials (Workstream B5).
-- ============================================================================
-- Stores per-firm secrets that are NOT shared platform accounts: each firm's own
-- Google service-account JSON (GA4/GSC), CallRail key, etc. Shared platform keys
-- (Anthropic, DataForSEO) stay in env vars and are NOT stored here.
--
-- SECURITY: this table is SERVER-ONLY. RLS is enabled with NO policies, so the
-- anon/authenticated (browser) clients can neither read nor write it — only the
-- service-role client (server code via getSupabaseAdmin) can touch it. Secrets
-- must never be sent to the browser; reads happen server-side via
-- lib/tenant-secrets.getTenantSecret().
-- Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.tenant_secrets (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);

alter table public.tenant_secrets enable row level security;

-- Deny all access to anon/authenticated by removing any policies. With RLS on
-- and zero policies, only the service-role key (which bypasses RLS) can access it.
do $$
declare p text;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tenant_secrets'
  loop
    execute format('drop policy if exists %I on public.tenant_secrets', p);
  end loop;
end $$;
