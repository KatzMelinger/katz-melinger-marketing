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
-- Tracked SEO competitors — persistent storage
-- ============================================================================
-- Replaces the in-memory Set + env-var defaults that previously held the
-- competitor list (and reset on every Vercel cold boot, losing any UI-added
-- competitors). Stored in Supabase so add/remove sticks.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project.
-- ============================================================================

create table if not exists public.seo_tracked_competitors (
  domain      text primary key,
  source      text not null default 'manual'
                check (source in ('manual', 'env_seed', 'suggested')),
  added_at    timestamptz not null default now()
);

alter table public.seo_tracked_competitors enable row level security;

drop policy if exists "auth read seo_tracked_competitors"
  on public.seo_tracked_competitors;
create policy "auth read seo_tracked_competitors"
  on public.seo_tracked_competitors
  for select
  to authenticated
  using (true);

-- Seed the table with the legacy default set so existing functionality
-- continues to work on first deploy. Idempotent via on conflict.
insert into public.seo_tracked_competitors (domain, source) values
  ('nilawfirm.com', 'env_seed'),
  ('outtengolden.com', 'env_seed'),
  ('nysplaw.com', 'env_seed'),
  ('employeerightslaw.com', 'env_seed')
on conflict (domain) do nothing;
