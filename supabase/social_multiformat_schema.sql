-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Social multi-format (master-spec 4A — feature flag: SOCIAL_MULTIFORMAT)
-- ----------------------------------------------------------------------------
-- Records the chosen per-platform format on each scheduled post. The composer's
-- live write path is social_posts (one row per platform = one variation), so the
-- format lives there. social_variations already has a post_type column
-- (supabase/social_variations_schema.sql) for the dormant variations model; this
-- adds the same to the table that's actually written.
--
-- Additive + idempotent. No CHECK — new values (story, video, whats_new, …) are
-- valid immediately. Run in the Supabase SQL editor before enabling the flag.
-- ============================================================================

alter table public.social_posts add column if not exists post_type text;

comment on column public.social_posts.post_type is
  'Chosen publish format: post | reel | story | carousel | video | whats_new | offer | event | pin | short (4A).';
