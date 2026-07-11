-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project. Confirm the project ref in
-- the dashboard URL matches .env.local before you click Run.
-- ============================================================================

-- ============================================================================
-- social_posts: per-post performance metrics (Phase 4 analytics)
-- ----------------------------------------------------------------------------
-- After a post goes live, /api/social/metrics/refresh pulls its stats from the
-- Ayrshare analytics endpoint and stores them here, refreshing shortly after
-- publish and again around 7 and 30 days. `metrics` holds the normalized figures
-- (impressions, reach, likes, comments, shares, clicks) plus the raw payload;
-- `metrics_updated_at` drives the refresh cadence and is shown on the calendar.
--
-- These live on social_posts because that flat row IS the per-platform post
-- (the "variation") in the current model. When the read path moves to the
-- normalized social_variations table, these move with it.
--
-- Both nullable + additive; safe to re-run. Existing rows are unaffected.
-- ============================================================================

alter table public.social_posts
  add column if not exists metrics jsonb;
alter table public.social_posts
  add column if not exists metrics_updated_at timestamptz;

-- The refresh job scans recently-live posts by schedule time.
create index if not exists social_posts_scheduled_at_idx
  on public.social_posts (tenant_id, scheduled_at);
