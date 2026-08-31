-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- legal_facts_cache.extracted_by — which parser produced this stored text
-- ============================================================================
-- The cache already expires by TIME (freshness_class + retrieved_at). That
-- handles a statute being amended. It does not handle the other way a cached
-- row goes wrong: the text was stored correctly for the parser of the day, and
-- then the PARSER changed.
--
-- This is not hypothetical. OpenLegislation embeds literal backslash-n
-- sequences in statute text; the extractor was fixed to strip them, and every
-- already-cached row kept its corrupted copy. Quote verification then failed
-- against the corrupted text while the fix looked applied — the same shape of
-- failure as the readability engine swap, where scores from a retired scorer
-- sat under the new scorer's label for nine days because nothing recorded which
-- engine produced them.
--
-- Recording the extractor revision makes a parser change invalidate its own
-- cache. Bump EXTRACTOR_REVISION in lib/legal-retrieval.ts whenever a change
-- alters the TEXT that comes out; rows from an older revision are then treated
-- as stale and refetched, rather than served forever.
--
-- Existing rows get revision 0, which will never match the current revision, so
-- they refetch on first use. That is the intended migration: the rows in the
-- table right now were produced by the broken parser.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.legal_facts_cache
  add column if not exists extracted_by integer not null default 0;

comment on column public.legal_facts_cache.extracted_by is
  'Extractor revision that produced authority_text. A row whose revision is older than the current EXTRACTOR_REVISION is stale and refetched, however recently it was retrieved.';

-- Finding rows a parser change has invalidated, without scanning the table.
create index if not exists legal_facts_cache_extractor_idx
  on public.legal_facts_cache (tenant_id, extracted_by);
