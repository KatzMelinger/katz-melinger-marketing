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
-- One-time migration: seo_target_keywords  ->  seo_keywords
-- ============================================================================
-- Unifies the two keyword lists onto seo_keywords (the richer, agent-visible
-- table). Copies every legacy target keyword that isn't already tracked,
-- skipping the internal seed marker. Case-insensitive de-dupe so "Severance"
-- and "severance" don't both land.
--
-- Safe to run multiple times. Run AFTER seed_tracked_keywords_from_semrush.sql.
-- search_volume / difficulty / rank are left for the refresh cron to fill.
-- ============================================================================

insert into public.seo_keywords (keyword, notes)
select t.keyword, 'migrated from seo_target_keywords'
from public.seo_target_keywords t
where t.keyword is not null
  and t.keyword <> '__seeded__'
  and length(trim(t.keyword)) > 0
  and not exists (
    select 1 from public.seo_keywords k
    where lower(k.keyword) = lower(t.keyword)
  )
on conflict (keyword) do nothing;

-- After confirming the tracker + KM Agent show the unified list, the legacy
-- table can be retired:
--   drop table if exists public.seo_target_keywords;
