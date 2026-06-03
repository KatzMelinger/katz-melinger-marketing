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
