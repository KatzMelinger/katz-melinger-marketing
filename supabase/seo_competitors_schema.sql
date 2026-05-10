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
