-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Current facts — editable store of current statutory figures
-- ============================================================================
-- The authoritative source of "current" time-sensitive figures (minimum wage,
-- salary thresholds, etc.) with effective dates. Edited on
-- /settings/current-facts, read by lib/current-facts-store.getCurrentFacts()
-- and injected into the content generators so drafts use correct values and the
-- freshness gate can show the reviewer the right number.
--
-- Falls back to the code-seeded list in lib/current-facts.ts when this table is
-- empty or unreachable, so nothing breaks before the migration runs.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.current_facts (
  id             uuid primary key default gen_random_uuid(),
  fact_key       text not null,
  label          text not null,
  value          text not null,
  jurisdiction   text not null default '',
  effective_date text not null default '',
  keywords       text[] not null default '{}',
  sort_order     integer not null default 0,
  tenant_id      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One fact_key per tenant.
create unique index if not exists current_facts_tenant_key_idx
  on public.current_facts (tenant_id, lower(fact_key));

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.current_facts enable row level security;

drop policy if exists "auth read current_facts" on public.current_facts;
create policy "auth read current_facts"
  on public.current_facts for select to authenticated using (true);
