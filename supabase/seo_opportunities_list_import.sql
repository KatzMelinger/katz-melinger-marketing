-- ============================================================================
-- SEO Opportunities — list import columns
-- ----------------------------------------------------------------------------
-- Adds support for importing named SEMrush keyword lists (e.g. "gap
-- retaliation", "3 competitors") into the persistent seo_opportunities spine.
--
-- The /api/seo/opportunities/import route upserts each row from an uploaded
-- CSV with source = 'imported' and a `list_name` tag, so the Radar can group
-- and filter by the same lists the marketing team builds inside SEMrush.
--
-- The daily /sync job never clears these columns: its upsert payload doesn't
-- include them, so Postgres leaves them untouched on conflict.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

alter table public.seo_opportunities
  add column if not exists list_name     text;

alter table public.seo_opportunities
  add column if not exists import_source text;  -- e.g. 'semrush_csv'

create index if not exists seo_opportunities_list_name_idx
  on public.seo_opportunities (list_name);
