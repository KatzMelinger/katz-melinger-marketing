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
-- SEO disavow workflow tracking
-- ============================================================================
-- Tracks the state of each toxic-risk referring domain so the Disavow
-- Manager can: (1) remember which domains have been submitted to Google
-- Search Console, (2) exclude already-handled domains from the export,
-- (3) surface a "disavowed / pending / safe" count on the dashboard.
--
-- Google's Disavow Links tool requires manual upload to Search Console
-- per property — there's no API. This table tracks our side of that
-- workflow so the same domains don't get re-listed every refresh.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project.
-- ============================================================================

create table if not exists public.seo_disavow_actions (
  domain     text primary key,
  status     text not null default 'pending'
               check (status in ('pending', 'disavowed', 'outreach_sent', 'safe')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_seo_disavow_actions_status
  on public.seo_disavow_actions (status);

alter table public.seo_disavow_actions enable row level security;

drop policy if exists "auth read seo_disavow_actions"
  on public.seo_disavow_actions;
create policy "auth read seo_disavow_actions"
  on public.seo_disavow_actions
  for select
  to authenticated
  using (true);

-- Auto-touch updated_at on row updates.
create or replace function public.touch_seo_disavow_actions_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_seo_disavow_actions_updated_at
  on public.seo_disavow_actions;
create trigger trg_seo_disavow_actions_updated_at
  before update on public.seo_disavow_actions
  for each row execute function public.touch_seo_disavow_actions_updated_at();
