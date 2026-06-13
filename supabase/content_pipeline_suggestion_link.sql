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
-- content_pipeline.suggestion_id — link a board item to its brief_suggestion
-- ============================================================================
-- Previously, when a draft was generated from a suggestion the link was written
-- to brief_suggestions.approved_draft_id only — the content_pipeline row was
-- never updated, so its draft_id stayed null and its status stayed 'brief'.
-- That's why Diana could see an item at Draft on the board but had no way to
-- open the actual draft.
--
-- This column lets "Send to Production" record which suggestion created the
-- board row, so draft generation (/api/content/km-draft) can find that row and
-- advance it: set draft_id + flip status brief→draft. Nullable — manually
-- created board items have no originating suggestion.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project after content_pipeline_schema.sql + content_pipeline_owner.sql.
-- ============================================================================

alter table public.content_pipeline
  add column if not exists suggestion_id uuid
    references public.brief_suggestions (id) on delete set null;

create index if not exists content_pipeline_suggestion_idx
  on public.content_pipeline (suggestion_id);
