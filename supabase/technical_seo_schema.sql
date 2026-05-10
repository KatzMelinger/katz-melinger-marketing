-- ============================================================================
-- Technical SEO scan cache
-- ============================================================================
-- PageSpeed Insights API calls can take 30-60 seconds each, and the technical
-- SEO page needs both mobile + desktop. Server-rendering this on every page
-- view hits Vercel function timeouts and chews PageSpeed quota. Cache the
-- latest result so the page renders instantly; the user clicks "Re-scan" to
-- refresh.
--
-- Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- Idempotent.
-- ============================================================================

create table if not exists public.technical_seo_runs (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  mobile        jsonb not null,
  desktop       jsonb not null,
  schema_checks jsonb not null default '[]'::jsonb,
  crawl_errors  jsonb not null default '[]'::jsonb,
  status        text not null default 'success' check (status in ('success', 'partial', 'failed')),
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists technical_seo_runs_created_idx
  on public.technical_seo_runs (created_at desc);
create index if not exists technical_seo_runs_url_idx
  on public.technical_seo_runs (url, created_at desc);

alter table public.technical_seo_runs enable row level security;

drop policy if exists "auth read technical_seo_runs" on public.technical_seo_runs;
create policy "auth read technical_seo_runs"
  on public.technical_seo_runs
  for select
  to authenticated
  using (true);
