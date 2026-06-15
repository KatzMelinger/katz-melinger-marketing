-- ============================================================================
-- Autonomous content agent — add 'needs_legal' hold status to content tables
-- ============================================================================
-- The agent's attorney-advertising compliance hard gate
-- (lib/agent/compliance-filter.ts) holds any item that fails compliance at a
-- new 'needs_legal' status. A held item CANNOT enter the approval inbox (which
-- reads status='review') and CANNOT be approved until edited to compliance.
--
-- - content_drafts: add 'needs_legal' alongside the existing statuses.
-- - content_pipeline: add 'needs_legal' (held) and 'approved' (the agent's
--   approval gate flips 'review' -> 'approved', mirroring wp_autopilot).
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- content_drafts ------------------------------------------------------------
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
      'needs_legal',
      'published',
      'approved',
      'archived'
    ));

-- content_pipeline ----------------------------------------------------------
alter table public.content_pipeline
  drop constraint if exists content_pipeline_status_check;

alter table public.content_pipeline
  add constraint content_pipeline_status_check
    check (status in (
      'idea',
      'brief',
      'draft',
      'review',
      'needs_legal',
      'approved',
      'published'
    ));
