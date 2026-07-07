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
--   2. When in doubt, .env.local wins, not any comment.
-- ============================================================================

-- ============================================================================
-- social_posts: last_error + media_urls
-- ----------------------------------------------------------------------------
-- last_error — when a post lands as status='failed' (Ayrshare rejected it, or
--   we blocked a guaranteed failure like a text-only Instagram post), store the
--   reason so it's findable later on the Content Calendar, not just in the
--   drawer at schedule time.
-- media_urls — the image/video URLs attached to the post (e.g. carousel slides).
--   Persisted so the Content Calendar can re-attach them when a post is
--   rescheduled (Ayrshare reschedule = delete + recreate, so we need the media).
--
-- Both nullable + additive; safe to re-run. Existing rows are unaffected.
-- ============================================================================

alter table public.social_posts
  add column if not exists last_error text;

alter table public.social_posts
  add column if not exists media_urls jsonb;
