-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_analyses.scored_against — what an analysis was computed against
-- ============================================================================
-- A stored analysis recorded its scores but never its input, so nothing could
-- tell a current score from an outdated one. Two things went wrong because of
-- that: an edited draft kept showing its pre-edit score, and the switch to the
-- rules-based readability engine silently changed what `readability_score`
-- MEANS without re-scoring anything — leaving most drafts displaying a Flesch
-- number under a rules-engine label.
--
-- This column records the sha256 of the scored body, the engine that scored it,
-- and when. lib/analysis-fingerprint.ts compares it to the draft's current body
-- and marks any mismatch STALE: not displayed as current, Apply disabled, and
-- refused by the approval gate.
--
-- Rows written before this migration have `scored_against = null`, which reads
-- as stale ("cannot be matched to the current draft") rather than as fresh.
-- That is deliberate — an unknown provenance is not a passing one.
--
-- The analyzer degrades gracefully if this column is missing (it drops the
-- field and retries), so running this migration is what turns the feature on.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.content_analyses
  add column if not exists scored_against jsonb;

comment on column public.content_analyses.scored_against is
  'What this analysis measured: { body_sha256, engine, scored_at }. Null = pre-dates fingerprinting, treated as stale.';

-- Finding the drafts whose newest analysis came from a retired engine is the
-- query behind the re-score sweep (scripts/rescore-stale-analyses.ts), so give
-- the engine key an index rather than scanning every analysis row.
create index if not exists content_analyses_engine_idx
  on public.content_analyses ((scored_against ->> 'engine'));
