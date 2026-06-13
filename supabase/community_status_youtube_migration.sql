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
