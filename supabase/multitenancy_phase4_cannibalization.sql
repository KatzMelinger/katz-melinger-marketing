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
-- Multi-tenancy — Phase 4 cluster (3/3): tenant-scoped RLS for cannibalization.
-- cannibalization_snapshots (id-keyed) → RLS flip. cannibalization.ts stamps +
-- scopes by tenant; ai-recommendations reads via the tenant client. Idempotent.
-- ============================================================================
alter table public.cannibalization_snapshots enable row level security;
do $$ declare p text; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='cannibalization_snapshots' loop
    execute format('drop policy if exists %I on public.cannibalization_snapshots', p);
  end loop;
end $$;
create policy "tenant rw cannibalization_snapshots" on public.cannibalization_snapshots
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
