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
-- WordPress AutoPilot — mechanical on-page fix queue + audit log + token auth
-- ============================================================================
-- Separate from recommendation_items (which is strategy-level): this is the
-- table of *applyable* on-page fixes that the KM AutoPilot WordPress plugin
-- polls and writes back to. Each row is one specific change to one page —
-- e.g. "change the meta title on /practice-areas/wage-theft to '...'".
--
-- Flow:
--   1. Detection (site crawler, on-page audit, AEO suggestions, etc.) inserts
--      rows with status='pending'.
--   2. Marketer reviews on the dashboard and flips them to 'approved'.
--   3. WP plugin polls GET /api/wp/recommendations?status=approved, applies
--      changes server-side, POSTs back to /api/wp/applied which flips status
--      to 'applied' and records applied_at + plugin metadata.
--   4. Marketer can later flip an 'applied' row to 'reverted' to roll back
--      (the plugin restores the prior value from current_value).
--
-- Auth: plugin sends X-KM-AutoPilot-Token. We store sha256 hashes only.
--
-- Idempotent. Run in Supabase SQL editor.
-- ============================================================================

create table if not exists public.wp_autopilot_tokens (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null,                         -- e.g. 'katzmelinger.com'
  token_hash    text not null unique,                  -- sha256 hex of the bearer token
  label         text,                                  -- human label for the dashboard
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists wp_autopilot_tokens_domain_idx
  on public.wp_autopilot_tokens (domain);

create table if not exists public.wp_autopilot_recommendations (
  id                       uuid primary key default gen_random_uuid(),
  domain                   text not null,
  page_url                 text not null,
  fix_type                 text not null check (fix_type in (
    'meta_title',
    'meta_description',
    'canonical',
    'schema_jsonld',
    'h1',
    'og_title',
    'og_description',
    'internal_link_insert',
    'alt_text'
  )),
  current_value            text,                        -- what's on the page now (for revert)
  suggested_value          text not null,               -- what we want to set it to
  rationale                text not null,               -- why (shown in plugin admin)
  status                   text not null default 'pending' check (status in (
    'pending',
    'approved',
    'applied',
    'rejected',
    'reverted'
  )),
  applied_at               timestamptz,
  applied_value            text,                        -- exactly what the plugin wrote
  reverted_at              timestamptz,
  wp_post_id               bigint,                      -- recorded after apply for revert
  source_recommendation_id uuid,                        -- optional link to recommendation_items
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists wp_autopilot_recs_domain_status_idx
  on public.wp_autopilot_recommendations (domain, status, created_at desc);
create index if not exists wp_autopilot_recs_url_idx
  on public.wp_autopilot_recommendations (page_url);

-- RLS — only authenticated users can read/write. The plugin uses the service
-- role key (via the Next API), not anon, so RLS doesn't gate it.
alter table public.wp_autopilot_tokens enable row level security;
alter table public.wp_autopilot_recommendations enable row level security;

drop policy if exists "auth read wp_autopilot_tokens" on public.wp_autopilot_tokens;
create policy "auth read wp_autopilot_tokens"
  on public.wp_autopilot_tokens
  for select to authenticated using (true);

drop policy if exists "auth write wp_autopilot_tokens" on public.wp_autopilot_tokens;
create policy "auth write wp_autopilot_tokens"
  on public.wp_autopilot_tokens
  for all to authenticated using (true) with check (true);

drop policy if exists "auth read wp_autopilot_recs" on public.wp_autopilot_recommendations;
create policy "auth read wp_autopilot_recs"
  on public.wp_autopilot_recommendations
  for select to authenticated using (true);

drop policy if exists "auth write wp_autopilot_recs" on public.wp_autopilot_recommendations;
create policy "auth write wp_autopilot_recs"
  on public.wp_autopilot_recommendations
  for all to authenticated using (true) with check (true);

-- Trigger to bump updated_at on row mutations.
create or replace function public.touch_wp_autopilot_recs()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wp_autopilot_recs_touch on public.wp_autopilot_recommendations;
create trigger wp_autopilot_recs_touch
  before update on public.wp_autopilot_recommendations
  for each row execute function public.touch_wp_autopilot_recs();
