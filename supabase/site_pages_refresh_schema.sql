-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL.
-- ============================================================================

-- ============================================================================
-- site_pages content-refresh tracking (spec 4.4).
-- ============================================================================
-- page_last_modified: from the sitemap's <lastmod> when the site publishes
--   one. Null means the sitemap didn't say — not "never updated". Populated by
--   the crawler in lib/site-inventory.ts; never guessed or backfilled.
-- refresh_status: human-set workflow state for the Site Inventory "Refresh"
--   tab, so a writer can mark a stale page as being worked on.
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.site_pages
  add column if not exists page_last_modified timestamptz;

alter table public.site_pages
  add column if not exists refresh_status text not null default 'not_started'
    check (refresh_status in ('not_started', 'in_progress', 'updated'));

alter table public.site_pages
  add column if not exists refresh_status_updated_at timestamptz;

create index if not exists site_pages_last_modified_idx
  on public.site_pages (page_last_modified);
create index if not exists site_pages_refresh_status_idx
  on public.site_pages (refresh_status);
