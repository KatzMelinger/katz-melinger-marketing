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
