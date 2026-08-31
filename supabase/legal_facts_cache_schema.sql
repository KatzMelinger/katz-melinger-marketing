-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- legal_facts_cache — the knowledge base, as Diana specified it
-- ============================================================================
-- Diana's Q4 (2026-08-25): "Retrieval against the authority sources is the
-- primary source. The knowledge base is a cache of what those checks already
-- confirmed, stored with its source and date, so a fact that was already
-- verified does not have to be looked up every time."
--
-- So this is a CACHE, not a curated table. Nothing is hand-authored into it.
-- Every row is the recorded result of a real fetch from an approved authority,
-- and the authority remains the source of truth — this only prevents fetching
-- the same section a hundred times.
--
-- WHY A ROW CAN BE WRONG, AND WHAT THAT MEANS
--
-- A cached row is a snapshot. Statutes are amended, regulations are revised,
-- and nothing here detects that. `retrieved_at` plus `freshness_class` is what
-- keeps a stale snapshot from being trusted indefinitely: past its window, the
-- entry is refetched rather than served. This is the one part of Diana's design
-- that has no automatic trigger — "immediate update whenever a law changes"
-- needs something watching for the change, which does not exist yet. The TTL is
-- the honest substitute until it does.
--
-- confirmation_status is deliberately NOT defaulted to confirmed. A row written
-- by an automatic fetch is `auto`; only a person moves it to `human_confirmed`.
-- Anything the fetch could not settle is `flagged` and never satisfies a check.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.legal_facts_cache (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default '00000000-0000-0000-0000-000000000001'
                  references public.tenants(id),

  -- The citation this row answers, in the parsed form the retrieval layer uses.
  corpus        text not null check (corpus in ('ny_consolidated', 'cfr', 'usc')),
  book          text not null,          -- 'LAB', 'EXC', '29'
  section       text not null,          -- '198-c', '825.100'

  -- Where it came from and when. Both are shown to the reviewer: a claim
  -- verified against a named URL on a named date is auditable; one verified
  -- against "the system" is not.
  source_url    text not null,
  retrieved_at  timestamptz not null default now(),

  -- The authority's own words. Truncated by the retrieval layer, never
  -- paraphrased — a paraphrase is a second place for an error to enter.
  authority_text text not null,

  -- How long this snapshot may be served before it must be refetched.
  --   volatile   agency guidance, dollar thresholds        30 days
  --   standard   most statutory text                       180 days
  --   stable     long-settled provisions                   365 days
  freshness_class text not null default 'standard'
                  check (freshness_class in ('volatile', 'standard', 'stable')),

  -- auto            written by a fetch, never reviewed by a person
  -- human_confirmed an attorney has read it and agrees
  -- flagged         the fetch was inconclusive; never satisfies a check
  confirmation_status text not null default 'auto'
                  check (confirmation_status in ('auto', 'human_confirmed', 'flagged')),
  confirmed_by_email  text,
  confirmed_at        timestamptz,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One cached row per citation per tenant. The retrieval layer upserts ON these
-- exact columns, so this must be a plain column index: an ON CONFLICT clause
-- cannot target a FUNCTIONAL index like lower(section), and the upsert would
-- fail at runtime with "no unique constraint matching the ON CONFLICT
-- specification" while the table looked perfectly well formed.
--
-- Case is normalised in the application before writing instead (sections are
-- stored lowercase), which is where the canonical form belongs anyway.
drop index if exists public.legal_facts_cache_citation_idx;
create unique index if not exists legal_facts_cache_citation_idx
  on public.legal_facts_cache (tenant_id, corpus, book, section);

-- "What is stale and needs refetching" — the maintenance query.
create index if not exists legal_facts_cache_freshness_idx
  on public.legal_facts_cache (tenant_id, freshness_class, retrieved_at);

comment on table public.legal_facts_cache is
  'Cache of authority lookups. The authority is the source of truth; this only avoids refetching. Rows expire by freshness_class.';

alter table public.legal_facts_cache enable row level security;
drop policy if exists legal_facts_cache_tenant on public.legal_facts_cache;
create policy legal_facts_cache_tenant on public.legal_facts_cache
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
