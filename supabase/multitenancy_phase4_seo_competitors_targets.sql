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
-- Multi-tenancy — Phase 4 module: tenant-scoped RLS for SEO competitors + targets.
-- ============================================================================
-- seo_tracked_competitors (PK domain) and seo_target_keywords (PK keyword) were
-- keyed by a single business column; repoint each PK to include tenant_id so
-- each firm has its own list, then flip RLS to tenant-scoped. The libs upsert
-- onConflict "tenant_id,domain" / "tenant_id,keyword". Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='seo_tracked_competitors' and con.contype='p'
      and pg_get_constraintdef(con.oid)='PRIMARY KEY (tenant_id, domain)') then
    alter table public.seo_tracked_competitors drop constraint if exists seo_tracked_competitors_pkey;
    alter table public.seo_tracked_competitors add primary key (tenant_id, domain);
  end if;
  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='seo_target_keywords' and con.contype='p'
      and pg_get_constraintdef(con.oid)='PRIMARY KEY (tenant_id, keyword)') then
    alter table public.seo_target_keywords drop constraint if exists seo_target_keywords_pkey;
    alter table public.seo_target_keywords add primary key (tenant_id, keyword);
  end if;
end $$;

do $$
declare t text; p text;
begin
  foreach t in array array['seo_tracked_competitors','seo_target_keywords'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
