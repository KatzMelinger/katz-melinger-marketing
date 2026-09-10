-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- current_facts.site_url — which of OUR OWN pages states this fact
-- ============================================================================
-- Distinct from the existing source_url column, which is the EXTERNAL
-- authority a value came from (a statute/agency page). site_url is the firm's
-- own page that currently states the fact (e.g. the About page's "20 years of
-- experience", or a practice-area page's "Nassau, Suffolk, and Westchester").
--
-- Feeds the S13(c) source-consistency check (Diana's build spec, Sept 8 2026):
-- when a draft states something that contradicts a tracked current fact, the
-- freshness gate and the social source-currency check can now cite the page
-- that has it right, not just the correct value — "naming both URLs".
--
-- Idempotent. Safe to re-run.
-- ============================================================================

alter table public.current_facts add column if not exists site_url text not null default '';
