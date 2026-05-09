-- ============================================================================
-- Recent-history tables for AI Search and Recommendations
-- ============================================================================
-- Adds persistence so users can revisit past scans and AI recommendations.
-- AEO already has its own runs/responses tables and surfaces history at /aeo.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

-- 1) AI Search readiness scans -----------------------------------------------
-- Each crawl + analysis pair gets a row so the user can re-load past scans
-- and see how their AI-readiness has changed over time.
create table if not exists public.ai_search_scans (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  base_url    text not null,
  crawl       jsonb not null,                                  -- the full AISiteCrawlResult
  analysis    jsonb,                                            -- nullable: scan may be crawl-only
  overall_score integer,                                        -- denormalized from analysis for sortable history list
  created_at  timestamptz not null default now()
);

create index if not exists ai_search_scans_created_at_idx on public.ai_search_scans (created_at desc);
create index if not exists ai_search_scans_domain_idx on public.ai_search_scans (domain);

-- 2) Recommendations history -------------------------------------------------
-- Snapshots of Claude's "what should we do next" output. Includes a pointer to
-- the evidence sizes so the user can tell which snapshots were rich vs sparse.
create table if not exists public.recommendations_history (
  id              uuid primary key default gen_random_uuid(),
  recommendations jsonb not null,
  evidence        jsonb not null default '{}'::jsonb,
  rec_count       integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists recommendations_history_created_at_idx
  on public.recommendations_history (created_at desc);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.ai_search_scans enable row level security;
alter table public.recommendations_history enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['ai_search_scans','recommendations_history'])
  loop
    execute format('drop policy if exists "auth read %I" on public.%I;', t, t);
    execute format(
      'create policy "auth read %I" on public.%I for select to authenticated using (true);',
      t, t
    );
  end loop;
end$$;
