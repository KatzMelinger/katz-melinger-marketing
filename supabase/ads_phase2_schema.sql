-- ============================================================================
-- Katz Melinger MarketOS — Paid Ads Schema, Phase 2
-- ============================================================================
-- Run this in the Supabase SQL editor after ads_schema.sql. Adds three tables
-- that back the no-API audit workflow:
--   1) ad_audits          — history of every account audit (track improvement)
--   2) ad_keyword_queue   — approve-before-publish queue for suggested negatives
--   3) ad_economics       — avg case value + close rate per practice area (ROI)
--
-- All three are tenant-scoped with the same RLS pattern as the other ad tables
-- (see multitenancy_phase4_ads.sql). The service role bypasses RLS; the
-- authenticated client is restricted to the caller's tenant. Idempotent.
-- ============================================================================

-- The default tenant id used as the column default everywhere in this app
-- (Katz Melinger). Matches multitenancy_phase1_schema.sql.
-- 00000000-0000-0000-0000-000000000001

-- 1) Audit history ----------------------------------------------------------
-- One row per audit run. The full Claude result is stored as jsonb so a past
-- audit can be reopened verbatim; the scalar columns power the trend list.
create table if not exists public.ad_audits (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                 references public.tenants(id) on delete cascade,
  platform     text not null,            -- google_search, microsoft, meta, ...
  report_type  text,                     -- search_terms, campaigns, ads, ...
  health_score integer,                  -- 0-100
  issue_count  integer not null default 0,
  neg_count    integer not null default 0,
  summary      text,
  result       jsonb not null,           -- the full AdsAuditResult
  created_at   timestamptz not null default now()
);

create index if not exists ad_audits_created_at_idx
  on public.ad_audits (created_at desc);
create index if not exists ad_audits_platform_idx
  on public.ad_audits (platform);

alter table public.ad_audits enable row level security;

-- 2) Negative-keyword approval queue ---------------------------------------
-- Audit-suggested negatives land here as 'pending' instead of going straight
-- into negative_keywords. A human approves/rejects; on approval the API copies
-- the keyword into negative_keywords (source 'audit') and flips this to
-- 'approved'. Mirrors the wp_autopilot pending->approved state machine.
create table if not exists public.ad_keyword_queue (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001'
                references public.tenants(id) on delete cascade,
  keyword     text not null,
  match_type  text not null default 'phrase',  -- exact, phrase, broad
  level       text not null default 'campaign', -- account, campaign
  reason      text,
  source      text not null default 'audit',
  status      text not null default 'pending',  -- pending, approved, rejected
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists ad_keyword_queue_status_idx
  on public.ad_keyword_queue (status, created_at desc);

alter table public.ad_keyword_queue enable row level security;

-- 3) Ad economics (case value + close rate) --------------------------------
-- The numbers needed to answer "should I even run ads": average case value and
-- lead->signed close rate, per practice area. practice_area 'All' is the
-- default/fallback row used when a specific area has no entry.
create table if not exists public.ad_economics (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.tenants(id) on delete cascade,
  practice_area   text not null default 'All',
  avg_case_value  numeric not null default 0,    -- USD revenue per signed case
  close_rate      numeric not null default 0,    -- 0-1, lead -> signed client
  notes           text,
  updated_at      timestamptz not null default now()
);

create unique index if not exists ad_economics_tenant_area_uniq
  on public.ad_economics (tenant_id, practice_area);

alter table public.ad_economics enable row level security;

-- ============================================================================
-- Tenant-scoped RLS policies (same shape as multitenancy_phase4_ads.sql)
-- ============================================================================
do $$
declare t text; p text;
begin
  foreach t in array array['ad_audits','ad_keyword_queue','ad_economics'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
