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
-- Multi-tenancy — Phase 4: tenant-scoped RLS for the internal/CRM surface.
-- Routes/libs use the service-role client, so isolation is enforced by the
-- explicit .eq("tenant_id", …) filters + stamps added in the app; RLS here is
-- defense-in-depth (and the enforcement path for any future authenticated
-- access). All id-PK -> RLS flip only, EXCEPT marketing_spend whose
-- UNIQUE(source, period_month) is repointed to include tenant_id.
--
-- Existence-guarded: brand_voice_documents / brand_voice_profiles aren't
-- present in every environment (the docs/profiles feature is unshipped), so we
-- skip any table that doesn't exist or lacks a tenant_id column.
-- Idempotent.
-- ============================================================================

-- marketing_spend: repoint the upsert conflict target to include tenant_id.
alter table public.marketing_spend
  drop constraint if exists marketing_spend_source_period_month_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketing_spend_tenant_source_period_key'
  ) then
    alter table public.marketing_spend
      add constraint marketing_spend_tenant_source_period_key
      unique (tenant_id, source, period_month);
  end if;
end $$;

do $$
declare t text; p text;
begin
  foreach t in array array[
    'calls','call_scores','prospects','sales_activities','reviews',
    'social_posts','oauth_tokens','marketing_spend','keyword_research_jobs',
    'brand_voice','brand_voice_documents','brand_voice_profiles'
  ] loop
    -- skip tables that don't exist or have no tenant_id column in this env
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='tenant_id'
    ) then continue; end if;

    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies
             where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
