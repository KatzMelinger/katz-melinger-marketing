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
-- content_analyses: add readability-detail columns
-- ============================================================================
-- The existing readability fields (readability_score 0-100, reading_grade_level,
-- word_count, sentence_count) stay as-is. This adds the per-check detail the
-- Content Studio readability panel + Production Board status chip need:
--
--   readability_avg_sentence_length    mean words/sentence
--   readability_long_sentences_count   sentences over the "long" cutoff
--   readability_long_paragraphs_count  paragraphs over the "long" cutoff
--   readability_passive_voice_pct      % of sentences in passive voice
--   readability_transition_word_pct    % of sentences opening with a transition
--   readability_consecutive_openers    runs of >=3 sentences with same opener
--   readability_subheading_gap_count   gaps between H2/H3 over the word cutoff
--   readability_overall_status         worst-of rollup: 'green'|'amber'|'red'
--
-- readability_checked_at is intentionally NOT added — content_analyses.created_at
-- already records when each analysis row was written (a new row per run).
-- The raw (un-normalized) Flesch value is not stored either; reading_grade_level
-- + readability_score already cover what the panel surfaces.
--
-- Idempotent (add column if not exists). Safe to re-run.
-- Run in the Supabase SQL editor for the LIVE marketing-SaaS project.
-- ============================================================================

alter table public.content_analyses
  add column if not exists readability_avg_sentence_length   numeric,
  add column if not exists readability_long_sentences_count  integer,
  add column if not exists readability_long_paragraphs_count integer,
  add column if not exists readability_passive_voice_pct     numeric,
  add column if not exists readability_transition_word_pct   numeric,
  add column if not exists readability_consecutive_openers   integer,
  add column if not exists readability_subheading_gap_count  integer,
  add column if not exists readability_overall_status        text;

-- Guard the status domain without blocking re-runs: drop + re-add the check.
alter table public.content_analyses
  drop constraint if exists content_analyses_readability_status_check;
alter table public.content_analyses
  add constraint content_analyses_readability_status_check
    check (readability_overall_status is null
           or readability_overall_status in ('green', 'amber', 'red'));

comment on column public.content_analyses.readability_avg_sentence_length is
  'Mean words per sentence over the Markdown-stripped body.';
comment on column public.content_analyses.readability_long_sentences_count is
  'Count of sentences above the tenant''s long-sentence word cutoff.';
comment on column public.content_analyses.readability_long_paragraphs_count is
  'Count of paragraphs above the tenant''s long-paragraph word cutoff.';
comment on column public.content_analyses.readability_passive_voice_pct is
  'Percentage of sentences detected as passive voice (0-100).';
comment on column public.content_analyses.readability_transition_word_pct is
  'Percentage of sentences opening with a transition word (0-100).';
comment on column public.content_analyses.readability_consecutive_openers is
  'Number of runs of >=3 consecutive sentences sharing the same opening word.';
comment on column public.content_analyses.readability_subheading_gap_count is
  'Number of H2/H3 gaps whose word span exceeds the subheading-gap cutoff.';
comment on column public.content_analyses.readability_overall_status is
  'Worst-of rollup across the readability sub-metrics: green | amber | red.';
