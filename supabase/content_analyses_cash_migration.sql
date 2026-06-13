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
-- content_analyses: add CASH scoring columns
-- ============================================================================
-- CASH = Conversational Authority, Answer completeness, Source expertise,
-- Human attribution — the framework from the Q1 2026 AI Search deck for
-- evaluating whether content is citation-worthy by AI answer engines.
--
-- Adds:
--   cash_score      0-100 weighted overall
--   cash_breakdown  jsonb with per-pillar scores (0-100 each)
--   cash_findings   jsonb array of pillar-specific feedback strings
--
-- Idempotent (uses if not exists / add column if not exists). Safe to re-run.
-- Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_analyses
  add column if not exists cash_score integer,
  add column if not exists cash_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists cash_findings jsonb not null default '[]'::jsonb;

comment on column public.content_analyses.cash_score is
  'CASH overall score 0-100. Conversational Authority / Answer Completeness / Source Expertise / Human Attribution.';
comment on column public.content_analyses.cash_breakdown is
  'Per-pillar CASH scores: { conversationalAuthority, answerCompleteness, sourceExpertise, humanAttribution }';
comment on column public.content_analyses.cash_findings is
  'Per-pillar findings array, e.g. ["[C] Opens with credibility marker", "[H] Author not identified"].';
