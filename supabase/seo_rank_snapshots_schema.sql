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
-- SEO rank snapshots — position history over time (you + competitors)
-- ----------------------------------------------------------------------------
-- One row per (tracked keyword × domain × day) recording where that domain
-- ranked for that keyword on that date. This is the time-series the single
-- current_rank/previous_rank pair on seo_keywords can't hold — it powers the
-- visibility trend chart and the date-over-date comparison columns (the
-- Semrush "Position Tracking" view).
--
-- Written daily by the tracked-keyword refresh cron (additive, never deletes).
-- `domain` holds the firm's own domain AND every tracked competitor, all
-- normalized (no scheme / www / trailing path). `rank` is null when the domain
-- was not found in the top 100 for that keyword.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project.
-- ============================================================================

create table if not exists public.seo_rank_snapshots (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  keyword      text not null,
  domain       text not null,            -- normalized; firm domain or competitor
  rank         integer,                  -- null = not in top 100 that day
  url          text,                     -- ranking URL (firm domain only, best-effort)
  captured_on  date not null,            -- daily granularity (one row per day)
  created_at   timestamptz not null default now(),
  unique (tenant_id, keyword, domain, captured_on)
);

-- Trend chart + comparison queries scan by tenant/domain over a date range.
create index if not exists seo_rank_snapshots_tenant_domain_date_idx
  on public.seo_rank_snapshots (tenant_id, domain, captured_on);

-- Per-keyword lookup across domains/dates (the comparison table).
create index if not exists seo_rank_snapshots_tenant_keyword_idx
  on public.seo_rank_snapshots (tenant_id, keyword, captured_on);

alter table public.seo_rank_snapshots enable row level security;

-- The MarketOS API routes use the service role key, which bypasses RLS.
-- This policy covers an authenticated user reaching the table directly.
drop policy if exists "auth read seo_rank_snapshots"
  on public.seo_rank_snapshots;
create policy "auth read seo_rank_snapshots"
  on public.seo_rank_snapshots
  for select
  to authenticated
  using (true);
