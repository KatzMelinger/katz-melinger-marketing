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
-- Calls: real marketing source (Diana's spec 8.3) + CallRail call_type (8.5)
-- ============================================================================
-- `source_name` is the CallRail TRACKER name ("Website pool"). The marketing
-- attribution Diana needs ("Google Organic", "SearchGPT", "Direct") is
-- CallRail's `source` field, now requested by lib/callrail-fetch.ts.
--
-- The app does NOT depend on this migration: /api/calls reads these values out
-- of `raw` (raw->>'source' etc.), and the sync drops these columns from its
-- upsert while they don't exist. Running this just gives them real columns for
-- SQL reporting. Safe to re-run.
-- ============================================================================

alter table public.calls add column if not exists marketing_source text;
alter table public.calls add column if not exists medium text;
alter table public.calls add column if not exists campaign text;
alter table public.calls add column if not exists landing_page_url text;
alter table public.calls add column if not exists referrer_domain text;
alter table public.calls add column if not exists call_type text;

-- Backfill from what the sync already stored in raw.
update public.calls set
  marketing_source = coalesce(marketing_source, raw->>'source'),
  medium           = coalesce(medium,           raw->>'medium'),
  campaign         = coalesce(campaign,         raw->>'campaign'),
  landing_page_url = coalesce(landing_page_url, raw->>'landing_page_url'),
  referrer_domain  = coalesce(referrer_domain,  raw->>'referrer_domain'),
  call_type        = coalesce(call_type,        raw->>'call_type')
where raw is not null;

create index if not exists calls_tenant_marketing_source_idx
  on public.calls (tenant_id, marketing_source);

-- The /calls page and /lead-response both range-scan on start_time per tenant.
create index if not exists calls_tenant_start_time_idx
  on public.calls (tenant_id, start_time desc);

-- PostgREST caches the schema; refresh so the sync sees the new columns now.
notify pgrst, 'reload schema';
