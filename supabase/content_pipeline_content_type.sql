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
