-- ============================================================================
-- content_pipeline.content_type — scope pipeline rows to Website / Social / Email
-- ============================================================================
-- The Content Studio now has three top-level tabs (Website, Social Media,
-- Email). Pipeline rows need a content_type so each tab's pipeline view
-- only shows items belonging to that type.
--
-- Existing rows default to 'website' (the most common pipeline target —
-- service pages, blog posts, FAQs, location pages). Re-tag rows manually
-- in the pipeline page after this migration if any belong to social/email.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_pipeline
  add column if not exists content_type text not null default 'website'
    check (content_type in ('website', 'social', 'email'));

create index if not exists content_pipeline_content_type_idx
  on public.content_pipeline (content_type);
