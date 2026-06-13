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
-- Multi-tenancy — Phase 4a: tenant_id on the stragglers.
-- ============================================================================
-- Phase 1 added tenant_id to most tables, but a number were created later
-- (seo_opportunities, recommendation_items) or were simply missed
-- (practice_areas, image_style_assets/channels, video_renders) and the
-- ex-CMS tables the marketing app uses (calls, call_scores, prospects,
-- sales_*, reviews, social_posts, keyword_research_jobs, marketing_spend,
-- constant_contact_*, oauth_tokens, brand_voice).
--
-- Same pattern as Phase 1: NOT NULL with a DEFAULT of the Katz Melinger
-- tenant, so existing rows backfill and tenant-unaware writes still land in
-- the right tenant. Non-breaking. Idempotent.
--
-- The `tenants` table itself is intentionally excluded (it IS the tenant).
-- ============================================================================

do $$
declare
  t text;
  tbls text[] := array[
    'brand_voice','call_scores','calls','constant_contact_automation',
    'constant_contact_sync_log','image_style_assets','image_style_channels',
    'keyword_research_jobs','marketing_spend','oauth_tokens','practice_areas',
    'prospects','recommendation_items','reviews','sales_activities',
    'sales_rubric','sales_training_materials','seo_opportunities',
    'social_posts','video_renders'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I add column if not exists tenant_id uuid not null default ''00000000-0000-0000-0000-000000000001'' references public.tenants(id)',
        t
      );
      execute format(
        'create index if not exists %I on public.%I (tenant_id)',
        t || '_tenant_idx', t
      );
    end if;
  end loop;
end $$;
