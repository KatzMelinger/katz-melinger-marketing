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
-- AI Recommendation items with workflow status
-- ============================================================================
-- Each individual recommendation gets its own row so the user can park them
-- in Done / Hold / Disregard buckets. Existing recommendations_history table
-- stays as a per-generation batch log; this is the persistent action list.
--
-- Done + Disregard titles get filtered out on the next Generate so Claude
-- doesn't keep re-suggesting work the user has already completed or rejected.
-- Hold items will reappear naturally (no filter).
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- ============================================================================

create table if not exists public.recommendation_items (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  rationale             text not null,
  category              text not null check (
    category in ('seo','aeo','content','technical','local','social')
  ),
  effort                text not null check (effort in ('low','medium','high')),
  impact                text not null check (impact in ('low','medium','high')),
  evidence              text not null,
  status                text not null default 'active' check (
    status in ('active','done','hold','disregard')
  ),
  source_generation_id  uuid,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists recommendation_items_status_idx
  on public.recommendation_items (status, created_at desc);

-- Case-insensitive title lookup for dedup on regenerate.
create index if not exists recommendation_items_title_lower_idx
  on public.recommendation_items (lower(title));

alter table public.recommendation_items enable row level security;

drop policy if exists "auth read recommendation_items" on public.recommendation_items;
create policy "auth read recommendation_items"
  on public.recommendation_items
  for select
  to authenticated
  using (true);

drop policy if exists "auth write recommendation_items" on public.recommendation_items;
create policy "auth write recommendation_items"
  on public.recommendation_items
  for all
  to authenticated
  using (true)
  with check (true);
