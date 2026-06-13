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
-- content_drafts.status — expand to pipeline statuses + initial_review
-- ============================================================================
-- Previously the column only allowed draft / approved / published / archived.
-- The drafts UI now exposes a status dropdown whose options mirror the
-- editorial pipeline (idea, brief, draft, review, published) plus an
-- "initial_review" state meaning the AI generation hasn't been triaged by
-- a human yet.
--
-- The old "draft" rows are remapped to "initial_review" so the new
-- dropdown can use "draft" with its pipeline meaning ("actively being
-- written"). Legacy approved / archived values are kept untouched.
--
-- Also adds a partial unique index on content_pipeline.draft_id so the
-- API can safely auto-create a pipeline row when a draft is promoted out
-- of initial_review, without producing duplicates on concurrent updates.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_drafts
  drop constraint if exists content_drafts_status_check;

alter table public.content_drafts
  add constraint content_drafts_status_check
    check (status in (
      'initial_review',
      'idea',
      'brief',
      'draft',
      'review',
      'published',
      'approved',
      'archived'
    ));

alter table public.content_drafts
  alter column status set default 'initial_review';

update public.content_drafts
   set status = 'initial_review'
 where status = 'draft';

create unique index if not exists content_pipeline_draft_id_unique
  on public.content_pipeline (draft_id)
  where draft_id is not null;
