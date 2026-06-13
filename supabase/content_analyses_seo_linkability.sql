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
-- content_analyses — add SEO + linkability scoring columns
-- ============================================================================
-- The draft analyzer was AEO/CASH/brand-voice focused. Add traditional
-- on-page SEO scoring (title, headings, keyword placement, authority links,
-- schema suggestion) and a separate linkability score that captures how
-- link-worthy a piece is plus concrete outreach pitch angles.
--
-- All columns are nullable so older analysis rows continue to load. The
-- analyzer in lib/content-analysis.ts gracefully degrades when these
-- columns are missing (catch + retry without them), so the migration
-- and the code roll out independently safely.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_analyses
  add column if not exists seo_score integer;
alter table public.content_analyses
  add column if not exists seo_findings jsonb not null default '[]'::jsonb;
alter table public.content_analyses
  add column if not exists seo_breakdown jsonb not null default '{}'::jsonb;

alter table public.content_analyses
  add column if not exists linkability_score integer;
alter table public.content_analyses
  add column if not exists linkability_findings jsonb not null default '[]'::jsonb;
alter table public.content_analyses
  add column if not exists outreach_angles jsonb not null default '[]'::jsonb;
