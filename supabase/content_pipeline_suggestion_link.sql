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
