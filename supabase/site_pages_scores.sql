-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project.
--
-- When in doubt, .env.local wins, not any comment in this repo.
-- ============================================================================

-- ============================================================================
-- site_pages quality scores — SEO / AEO / CASH per published page
-- ============================================================================
-- Adds the per-page content scores used by the Site Inventory "Optimize" tab,
-- populated monthly by /api/content/site-inventory/score (which fetches each
-- live page and runs the same SEO/AEO/CASH scorers as the draft analyzer).
-- A page shows up in Optimize when any score is below the firm's standard.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.site_pages
  add column if not exists seo_score  integer,   -- 0-100 heuristic SEO score
  add column if not exists aeo_score  integer,   -- 0-100 heuristic answer-engine score
  add column if not exists cash_score integer,   -- 0-100 AI-evaluated CASH score (nullable)
  add column if not exists scored_at  timestamptz;  -- when this page was last scored

create index if not exists site_pages_scored_at_idx on public.site_pages (scored_at);
