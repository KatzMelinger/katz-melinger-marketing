-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref in the Supabase dashboard URL matches the ref in .env.local before Run.
-- (Apply via apply-sql.mjs through the pooler — the default direct host is
--  IPv6-only and fails locally.)
-- ============================================================================

-- ============================================================================
-- WordPress AutoPilot — failure write-back
-- ----------------------------------------------------------------------------
-- Extends wp_autopilot_recommendations so the plugin can report back when a
-- fix could NOT be applied, instead of leaving the row stuck in 'approved' and
-- silently re-attempting it every 15-minute sync.
--
-- Two new terminal-ish states:
--   'failed'       — the plugin tried and could not apply (e.g. no post resolved
--                    for the URL, unknown fix_type). Surfaced with a reason; a
--                    marketer can Retry (flip back to 'approved') after fixing
--                    the underlying cause.
--   'needs_manual' — the fix_type isn't auto-appliable in this plugin version
--                    (h1, internal_link_insert, alt_text). Not an error — a
--                    human applies it by hand. Drops out of the sync queue.
--
-- Both leave the approved-only fetch (GET /api/wp/recommendations?status=approved)
-- so the plugin stops thrashing on them.
--
-- Idempotent. Run in Supabase SQL editor / apply-sql.mjs.
-- ============================================================================

-- New columns (nullable / defaulted, so existing rows are unaffected).
alter table public.wp_autopilot_recommendations
  add column if not exists failure_reason text;

alter table public.wp_autopilot_recommendations
  add column if not exists failed_at timestamptz;

alter table public.wp_autopilot_recommendations
  add column if not exists attempts integer not null default 0;

-- Widen the status check to include the two new states. The original constraint
-- is inline-named by Postgres as <table>_status_check; drop and re-add it.
alter table public.wp_autopilot_recommendations
  drop constraint if exists wp_autopilot_recommendations_status_check;

alter table public.wp_autopilot_recommendations
  add constraint wp_autopilot_recommendations_status_check
  check (status in (
    'pending',
    'approved',
    'applied',
    'rejected',
    'reverted',
    'failed',
    'needs_manual'
  ));

-- Index to make the dashboard "Failed / stuck" filter cheap.
create index if not exists wp_autopilot_recs_status_idx
  on public.wp_autopilot_recommendations (tenant_id, status, updated_at desc);
