-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref in the dashboard URL matches .env.local before clicking Run.
-- ============================================================================

-- ============================================================================
-- Authority snapshots — domain-authority time series for the competitor
-- authority-comparison trend chart (/seo/competitors).
-- ----------------------------------------------------------------------------
-- One row per (tenant, domain, day). Written by the daily tracked-keyword
-- refresh cron (lib/authority-history.writeAuthoritySnapshots) for the firm's
-- own domain AND every tracked competitor. The comparison view reads this table
-- to draw "our authority vs. top competitors over time".
--
-- IMPORTANT: history only accrues from the day the cron starts writing — there
-- is no backfill. The trend line is sparse until a few weeks of data exist.
-- Authority moves slowly, so a daily cadence is plenty (the unique key makes it
-- idempotent within a day regardless of how often the cron runs).
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.authority_snapshots (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,

  domain            text not null,             -- normalized (no scheme / www)
  authority_score   integer,                   -- 0-100 (DataForSEO rank ÷ 10)
  backlinks         integer,
  referring_domains integer,

  captured_on       date not null,             -- one snapshot per domain per day
  created_at        timestamptz not null default now(),

  unique (tenant_id, domain, captured_on)
);

alter table public.authority_snapshots enable row level security;

drop policy if exists "auth read authority_snapshots"
  on public.authority_snapshots;
create policy "auth read authority_snapshots"
  on public.authority_snapshots
  for select
  to authenticated
  using (true);

create index if not exists authority_snapshots_domain_date_idx
  on public.authority_snapshots (tenant_id, domain, captured_on);
create index if not exists authority_snapshots_date_idx
  on public.authority_snapshots (tenant_id, captured_on desc);
