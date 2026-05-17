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
