-- ============================================================================
-- Add 'youtube' to community_post_status.platform check constraint
-- ============================================================================
-- The existing constraint only allowed reddit/hackernews/news. YouTube
-- comment scanning needs its own platform tag.
--
-- Idempotent. Run after community_status_schema.sql.
-- ============================================================================

alter table public.community_post_status
  drop constraint if exists community_post_status_platform_check;

alter table public.community_post_status
  add constraint community_post_status_platform_check
  check (platform in ('reddit', 'hackernews', 'news', 'youtube'));
