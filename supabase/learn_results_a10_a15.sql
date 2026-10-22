-- Oct 20 spec, Tasks A10 and A15: learn from results, keep live pages correct.
-- Run once in the Supabase SQL editor (project ijlesksgnfqqpxtaelqs). Safe to re-run.

-- A10: every correction Diana or an attorney makes by hand becomes a case the
-- system is re-checked against every day.
create table if not exists public.regression_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  draft_id uuid,
  before_text text not null,
  after_text text not null,
  by_email text,
  by_role text not null default 'editor',          -- 'editor' | 'attorney'
  is_fact boolean not null default false,
  kb_status text not null default 'n/a',           -- 'n/a' | 'learned' | 'pending_attorney'
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_result text,                                -- 'pass' | 'fail'
  last_detail text,
  created_at timestamptz not null default now(),
  unique (tenant_id, before_text, after_text)
);
create index if not exists regression_cases_tenant_idx on public.regression_cases (tenant_id, created_at desc);

-- A15: each live katzmelinger.com page, scanned once a quarter: which
-- knowledge base entries it cites, and the trap and source check problems.
create table if not exists public.live_page_scans (
  tenant_id uuid not null,
  url text not null,
  title text,
  scanned_at timestamptz not null default now(),
  kb_keys text[] not null default '{}',
  claims integer not null default 0,
  trap_findings jsonb not null default '[]'::jsonb,
  source_entries jsonb not null default '[]'::jsonb,
  error text,
  primary key (tenant_id, url)
);
create index if not exists live_page_scans_kb_idx on public.live_page_scans using gin (kb_keys);

-- A15: one refresh draft per page per knowledge base change (or dated fact),
-- so a change never opens the same refresh twice.
create table if not exists public.kb_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kb_key text not null,
  url text not null,
  reason text not null,
  title text,
  note text,
  draft_id uuid,
  error text,
  created_at timestamptz not null default now(),
  unique (tenant_id, kb_key, url, reason)
);
create index if not exists kb_refresh_requests_pending_idx on public.kb_refresh_requests (tenant_id, created_at) where draft_id is null and error is null;
