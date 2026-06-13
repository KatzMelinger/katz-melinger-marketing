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
-- Multi-tenancy — Phase 4: tenant-scoped RLS for community_post_status + video_renders.
-- community_post_status PK (platform, post_id) -> (tenant_id, platform, post_id).
-- video_renders is id-keyed (RLS flip only). Idempotent.
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='community_post_status' and con.contype='p'
      and pg_get_constraintdef(con.oid)='PRIMARY KEY (tenant_id, platform, post_id)') then
    alter table public.community_post_status drop constraint if exists community_post_status_pkey;
    alter table public.community_post_status add primary key (tenant_id, platform, post_id);
  end if;
end $$;
do $$
declare t text; p text;
begin
  foreach t in array array['community_post_status','video_renders'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
