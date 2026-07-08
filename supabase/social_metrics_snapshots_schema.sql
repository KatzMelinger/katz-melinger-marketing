-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project. Confirm the project ref in
-- the dashboard URL matches .env.local before you click Run.
-- ============================================================================

-- ============================================================================
-- social_metrics_snapshots — frozen monthly social figures per platform
-- ----------------------------------------------------------------------------
-- One row per (tenant × platform × period_month) holding that platform's totals
-- for a single calendar month. This is the history the live Metricool dashboard
-- can't hold: it lets the Monthly Report compute month-over-month deltas
-- (June vs May) instantly and — crucially — *stably*, so a report you generated
-- for June doesn't shift if Metricool later re-states its numbers.
--
-- Written monthly by /api/social/report/snapshot (Vercel Cron, runs on the 1st
-- for the month that just ended) and on-demand by the same route's POST. The
-- report API falls back to a live Metricool query for any month with no row
-- yet (e.g. the in-progress current month), so the feature works before the
-- first snapshot ever lands.
--
-- `period_month` is the FIRST day of the month (e.g. 2026-06-01) at date
-- granularity. Numeric metrics are that month's totals; follower fields are
-- point-in-time / net for the month. `clicks` and follower fields are nullable
-- because Metricool doesn't expose them for every network (we store null rather
-- than invent a 0). `extra` holds platform-specific bits that don't warrant a
-- column (top post, follower-vs-non-follower splits) without over-normalizing.
--
-- Idempotent. Additive — never deletes. Mirrors the seo_rank_snapshots pattern.
-- ============================================================================

create table if not exists public.social_metrics_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  platform           text not null,             -- facebook | instagram | linkedin | tiktok
  period_month       date not null,             -- first day of the month
  impressions        integer not null default 0,-- views / impressions
  reach              integer not null default 0,-- reach / unique viewers
  engagement         integer not null default 0,-- interactions (likes+comments+shares+…)
  clicks             integer,                   -- clicks & visits — null when unavailable
  net_new_followers  integer,                   -- follower change across the month
  total_followers    integer,                   -- follower count at month end
  posts              integer not null default 0,
  extra              jsonb not null default '{}'::jsonb,
  captured_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (tenant_id, platform, period_month)
);

-- The report reads a tenant's rows for a month and the prior month.
create index if not exists social_metrics_snapshots_tenant_month_idx
  on public.social_metrics_snapshots (tenant_id, period_month);

alter table public.social_metrics_snapshots enable row level security;

-- The MarketOS API routes use the service-role key, which bypasses RLS. This
-- policy covers an authenticated user reaching the table directly.
drop policy if exists "auth read social_metrics_snapshots"
  on public.social_metrics_snapshots;
create policy "auth read social_metrics_snapshots"
  on public.social_metrics_snapshots
  for select
  to authenticated
  using (true);
