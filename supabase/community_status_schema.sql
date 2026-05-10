-- ============================================================================
-- Community post status — persistence for the /community scanners
-- ============================================================================
-- The Reddit / HN / News scanners pull live data on every scan, so posts
-- come and go. This table records the status the team has assigned to each
-- post (responded / skipped / starred) so future scans can hide the noise
-- and surface only what's still actionable.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists public.community_post_status (
  -- Composite primary key: same post_id can appear under different platforms
  platform     text not null check (platform in ('reddit', 'hackernews', 'news')),
  post_id      text not null,
  status       text not null default 'new'
                check (status in ('new', 'responded', 'skipped', 'starred')),
  notes        text,
  marked_by    uuid references auth.users (id) on delete set null,
  marked_at    timestamptz not null default now(),
  primary key (platform, post_id)
);

create index if not exists community_post_status_status_idx
  on public.community_post_status (status, marked_at desc);

alter table public.community_post_status enable row level security;

drop policy if exists "auth read community_post_status" on public.community_post_status;
create policy "auth read community_post_status"
  on public.community_post_status
  for select
  to authenticated
  using (true);
