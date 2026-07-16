-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Citation consistency snapshots — history layer for the Citations page
-- ============================================================================
-- Each audit run records a daily snapshot of the tracked-citation counts so the
-- page can chart consistency/coverage over time (Directories & Citations doc
-- section 7). One row per tenant per calendar day (upsert), written by
-- lib/seo-citations.saveCitationSnapshot() after an audit.
--
-- Fail-soft: the app only writes/reads snapshots best-effort, so nothing breaks
-- before this migration runs — the trend panel just stays empty.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.seo_citation_snapshots (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default '00000000-0000-0000-0000-000000000001'
                     references public.tenants(id) on delete cascade,
  captured_on      date not null default current_date,
  total            integer not null default 0,
  consistent       integer not null default 0,
  inconsistent     integer not null default 0,
  missing          integer not null default 0,
  unverified       integer not null default 0,
  consistency_pct  integer not null default 0,
  created_at       timestamptz not null default now()
);

-- One snapshot per tenant per day; a same-day re-audit updates it.
create unique index if not exists seo_citation_snapshots_tenant_day_idx
  on public.seo_citation_snapshots (tenant_id, captured_on);

create index if not exists seo_citation_snapshots_tenant_time_idx
  on public.seo_citation_snapshots (tenant_id, captured_on desc);

-- ============================================================================
-- RLS — tenant-scoped read/write (mirrors seo_citations)
-- ============================================================================

alter table public.seo_citation_snapshots enable row level security;

drop policy if exists "tenant rw seo_citation_snapshots" on public.seo_citation_snapshots;
create policy "tenant rw seo_citation_snapshots"
  on public.seo_citation_snapshots for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
