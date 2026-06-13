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
-- content_analyses — add suggested_titles + suggested_images columns
-- ============================================================================
-- The analyzer can now generate title alternatives (when no title is set
-- on the draft) and image suggestions (always). Both render in the
-- analysis card on /content/drafts so the user can act on them
-- immediately — pick a title or send the image suggestion to a designer.
--
-- Both columns are nullable jsonb arrays with empty-array defaults so
-- older analysis rows continue to load. The analyzer in
-- lib/content-analysis.ts gracefully degrades when these columns are
-- missing, so code + SQL roll out independently.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_analyses
  add column if not exists suggested_titles jsonb not null default '[]'::jsonb;

alter table public.content_analyses
  add column if not exists suggested_images jsonb not null default '[]'::jsonb;
