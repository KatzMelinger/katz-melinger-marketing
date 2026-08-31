-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- legal_facts_cache.corpus — admit the two New Jersey corpora
-- ============================================================================
-- The cache's corpus check allowed only ny_consolidated, cfr and usc. Adding
-- New Jersey retrieval without widening it meant every NJ fetch succeeded and
-- then failed to cache, refetching the same 296KB page on every single claim.
--
-- It failed LOUDLY, which is why this migration exists at all: the write error
-- was logged rather than swallowed, so the constraint surfaced during testing
-- instead of turning into a quiet performance problem nobody traced.
--
--   nj_statute  N.J.S.A. — served from the Department of Labor's wage-and-hour
--               page for Title 34:11, and from the local corpus in
--               legal-corpus/nj for everything New Jersey does not publish
--               machine-readably (NJLAD, CEPA).
--   njac        N.J.A.C. — the 12:56 wage regulations, on that same page.
--
-- Nothing outside those scopes is addressable, and lib/legal-citation.ts
-- returns null for it, so no row can be written for a citation that was never
-- actually retrieved.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.legal_facts_cache
  drop constraint if exists legal_facts_cache_corpus_check;

alter table public.legal_facts_cache
  add constraint legal_facts_cache_corpus_check
  check (corpus in ('ny_consolidated', 'cfr', 'usc', 'nj_statute', 'njac'));

comment on column public.legal_facts_cache.corpus is
  'ny_consolidated | cfr | usc | nj_statute | njac. Which body of law the cached text belongs to.';
