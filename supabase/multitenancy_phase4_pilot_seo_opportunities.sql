-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project.
--
-- Before you click Run:
--   1. Open the Supabase dashboard and confirm the project ref in the URL
--      matches the ref in .env.local's NEXT_PUBLIC_SUPABASE_URL.
--   2. Any project ref written elsewhere in this file may predate the
--      multitenancy migration (yijrpbdctzrgfpwdezqn -> ijlesksgnfqqpxtaelqs).
--      When in doubt, .env.local wins, not the comment.
-- ============================================================================

-- ============================================================================
-- Multi-tenancy — Phase 4 PILOT: enforce tenant isolation on seo_opportunities.
-- ============================================================================
-- Step A (this file, safe to apply before the code ships):
--   * Add a (tenant_id, keyword) unique constraint ALONGSIDE the existing
--     (keyword) one, so both the old code (onConflict "keyword") and the new
--     code (onConflict "tenant_id,keyword") work — zero-downtime.
--   * Flip RLS from permissive to tenant-scoped. Safe now because the deployed
--     code reads via the service-role client, which bypasses RLS; real
--     enforcement kicks in once the routes move to the authenticated client.
--
-- Step B (multitenancy_phase4_pilot_seo_opportunities_dropunique.sql) drops the
-- old (keyword)-only unique constraint AFTER the new code is deployed, which is
-- what finally allows two firms to track the same keyword.
--
-- Idempotent.
-- ============================================================================

-- (tenant_id, keyword) uniqueness — the multi-tenant upsert key.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seo_opportunities_tenant_keyword_key') then
    alter table public.seo_opportunities
      add constraint seo_opportunities_tenant_keyword_key unique (tenant_id, keyword);
  end if;
end $$;

-- Tenant-scoped RLS (replace any permissive policies).
alter table public.seo_opportunities enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='seo_opportunities' loop
    execute format('drop policy if exists %I on public.seo_opportunities', p);
  end loop;
end $$;
create policy "tenant rw seo_opportunities" on public.seo_opportunities
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
