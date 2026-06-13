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
-- AI Overview tracking on seo_keywords
-- ----------------------------------------------------------------------------
-- Records, per tracked keyword, whether Google shows an AI Overview for it and
-- whether the firm's domain is cited inside that overview — so the team can see
-- where AI answers may be intercepting clicks (and where we're/aren't in them).
-- Populated by the tracked-keyword refresh via DataForSEO's SERP advanced
-- endpoint. Additive + idempotent.
-- ============================================================================

alter table public.seo_keywords
  add column if not exists ai_overview_present boolean;          -- AI Overview shown for this keyword
alter table public.seo_keywords
  add column if not exists ai_overview_cited boolean;            -- our domain cited in the overview
alter table public.seo_keywords
  add column if not exists ai_overview_sources jsonb not null default '[]'::jsonb; -- domains cited
alter table public.seo_keywords
  add column if not exists ai_overview_checked_at timestamptz;

create index if not exists seo_keywords_ai_overview_idx
  on public.seo_keywords (tenant_id, ai_overview_present);
