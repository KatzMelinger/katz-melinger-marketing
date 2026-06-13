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
-- Intelligence Layer schema — backend pipeline storage
-- ----------------------------------------------------------------------------
-- Backs the 5-step keyword → page-decision pipeline that runs inside the
-- existing /api/seo/opportunities/sync job. Per the architecture decision, we
-- KEEP the keyword-centric model (one row per keyword in seo_opportunities)
-- and expose "page decisions" as a grouped VIEW rather than a second table.
--
-- This file:
--   1. Adds pipeline columns to seo_opportunities (Steps 1, 3, 5).
--   2. Creates competitor_gaps     (Step 4 output, persisted).
--   3. Creates gsc_page_positions  (Step 3 input: real GSC positions per URL).
--   4. Creates pipeline_logs        (scheduler run audit trail).
--   5. Creates the page_decisions VIEW (Step 2 grouped read model).
--
-- Multi-tenancy: every new table carries tenant_id (FK -> tenants), defaulting
-- to the Katz Melinger tenant so existing single-tenant data is unaffected.
-- Isolation is enforced in application code via resolveTenantId()+.eq(), since
-- server queries use the service-role client (RLS is a backstop only — see
-- lib/tenant-context.ts). RLS is still enabled below for defense in depth.
--
-- Idempotent. Safe to re-run in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) seo_opportunities — pipeline columns
-- ----------------------------------------------------------------------------
-- Step 1 (Intent Classifier): flag rows that fell through to the default label
--   so Diana can review/override them in a queue.
alter table public.seo_opportunities
  add column if not exists labeled_by_default boolean not null default false;

-- Step 3 (Cannibalization Check): the action Diana should take on this term,
--   plus the evidence used to decide it.
alter table public.seo_opportunities
  add column if not exists action_label text;            -- 'create' | 'optimize' | 'update'
alter table public.seo_opportunities
  add column if not exists existing_url_position integer; -- live GSC position of existing_url
alter table public.seo_opportunities
  add column if not exists existing_url_modified_at timestamptz; -- content freshness for the 6mo "update" rule

-- Step 5 (Opportunity Scorer): the priority score + human-readable bucket.
alter table public.seo_opportunities
  add column if not exists opportunity_score integer;     -- 0-100 weighted priority
alter table public.seo_opportunities
  add column if not exists priority_label text;           -- 'high' | 'medium' | 'low'

create index if not exists seo_opportunities_action_label_idx
  on public.seo_opportunities (action_label);
create index if not exists seo_opportunities_opportunity_score_idx
  on public.seo_opportunities (opportunity_score desc);
create index if not exists seo_opportunities_labeled_by_default_idx
  on public.seo_opportunities (labeled_by_default);

-- ----------------------------------------------------------------------------
-- 2) competitor_gaps — Step 4 output (persisted, was on-the-fly only)
-- ----------------------------------------------------------------------------
-- A confirmed gap = a tracked competitor ranks positions 1-20 AND we have no
-- URL or rank 21+. One row per (tenant, keyword, competitor) so the scorecard
-- can report BOTH the deduplicated page-decision count and the per-competitor
-- keyword-beat count without ever summing across competitors.
create table if not exists public.competitor_gaps (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default '00000000-0000-0000-0000-000000000001'
                        references public.tenants(id) on delete cascade,
  keyword             text not null,
  opportunity_id      uuid references public.seo_opportunities(id) on delete set null,
  competitor_domain   text not null,
  competitor_position integer,
  our_position        integer,      -- null/0 = we don't rank
  search_volume       integer,
  confirmed_gap       boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, keyword, competitor_domain)
);

create index if not exists competitor_gaps_tenant_idx
  on public.competitor_gaps (tenant_id);
create index if not exists competitor_gaps_confirmed_idx
  on public.competitor_gaps (tenant_id, confirmed_gap);
create index if not exists competitor_gaps_domain_idx
  on public.competitor_gaps (tenant_id, competitor_domain);

alter table public.competitor_gaps enable row level security;
drop policy if exists "auth read competitor_gaps" on public.competitor_gaps;
create policy "auth read competitor_gaps"
  on public.competitor_gaps for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 3) gsc_page_positions — Step 3 input (real Search Console positions per URL)
-- ----------------------------------------------------------------------------
-- We already query GSC per-URL but never persisted it. Store the latest
-- snapshot per (tenant, url) so the Cannibalization Check can distinguish
-- Optimize (pos > 20) from Update (top 20) without a live GSC call each run.
create table if not exists public.gsc_page_positions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default '00000000-0000-0000-0000-000000000001'
                  references public.tenants(id) on delete cascade,
  page_url      text not null,
  position      numeric,
  clicks        integer,
  impressions   integer,
  ctr           numeric,
  captured_at   timestamptz not null default now(),
  unique (tenant_id, page_url)
);

create index if not exists gsc_page_positions_tenant_idx
  on public.gsc_page_positions (tenant_id);

alter table public.gsc_page_positions enable row level security;
drop policy if exists "auth read gsc_page_positions" on public.gsc_page_positions;
create policy "auth read gsc_page_positions"
  on public.gsc_page_positions for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 4) pipeline_logs — scheduler run audit trail (stop-on-error visibility)
-- ----------------------------------------------------------------------------
-- One row per pipeline run per tenant. If a step throws, the scheduler stops
-- and writes status='failed' with the step it reached, so Diana can see if the
-- pipeline failed overnight instead of silently serving stale data.
create table if not exists public.pipeline_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default '00000000-0000-0000-0000-000000000001'
                  references public.tenants(id) on delete cascade,
  run_at        timestamptz not null default now(),
  step_reached  text,                                  -- 'classify' | 'group' | 'cannibalization' | 'gaps' | 'score' | 'done'
  status        text not null default 'success',       -- 'success' | 'failed'
  error_message text,
  counts        jsonb not null default '{}'::jsonb,     -- { keywords: 204, decisions: 31, gaps: 47, ... }
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists pipeline_logs_tenant_run_idx
  on public.pipeline_logs (tenant_id, run_at desc);
create index if not exists pipeline_logs_status_idx
  on public.pipeline_logs (tenant_id, status);

alter table public.pipeline_logs enable row level security;
drop policy if exists "auth read pipeline_logs" on public.pipeline_logs;
create policy "auth read pipeline_logs"
  on public.pipeline_logs for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 5) page_decisions — Step 2 grouped read model (VIEW, not a table)
-- ----------------------------------------------------------------------------
-- Collapses the keyword-centric seo_opportunities rows into one "page decision"
-- per (tenant, pillar, content type). pillar_id is the stable "topic" key in
-- this codebase; recommended_content_type is the intent label. Same topic +
-- DIFFERENT intent => different content type => separate decision, exactly as
-- the spec requires. Excluded/dismissed rows are filtered out.
--
-- For each group we surface: the primary (highest-volume) keyword, how many
-- keywords rolled up, the combined volume, the most-urgent action, and the
-- best (max) opportunity score + its priority label.
create or replace view public.page_decisions as
with ranked as (
  select
    o.*,
    coalesce(o.pillar_id, '(unassigned)')                          as group_pillar,
    coalesce(o.recommended_content_type, 'blog_post')              as group_content_type,
    row_number() over (
      partition by o.tenant_id,
                   coalesce(o.pillar_id, '(unassigned)'),
                   coalesce(o.recommended_content_type, 'blog_post')
      order by coalesce(o.search_volume, 0) desc, o.keyword
    )                                                              as vol_rank,
    -- urgency rank: create (3) > optimize (2) > update (1) > unknown (0)
    case o.action_label
      when 'create'   then 3
      when 'optimize' then 2
      when 'update'   then 1
      else 0
    end                                                            as action_rank
  from public.seo_opportunities o
  where coalesce(o.excluded, false) = false
    and coalesce(o.status, 'new') <> 'dismissed'
)
select
  r.tenant_id,
  r.group_pillar                                                   as pillar_id,
  r.group_content_type                                             as content_type,
  r.practice_area,
  -- primary keyword = highest volume in the group
  max(r.keyword) filter (where r.vol_rank = 1)                     as primary_keyword,
  count(*)                                                         as keyword_count,
  coalesce(sum(r.search_volume), 0)                                as combined_volume,
  -- most urgent action across the grouped keywords
  (array_agg(r.action_label order by r.action_rank desc, r.keyword))[1] as action_label,
  max(r.opportunity_score)                                         as opportunity_score,
  (array_agg(r.priority_label order by coalesce(r.opportunity_score, 0) desc))[1] as priority_label,
  bool_or(r.labeled_by_default)                                    as needs_review,
  array_agg(r.id order by coalesce(r.search_volume, 0) desc)       as opportunity_ids,
  max(r.last_synced_at)                                            as last_synced_at
from ranked r
group by r.tenant_id, r.group_pillar, r.group_content_type, r.practice_area;

-- ============================================================================
-- End intelligence_layer_schema.sql
-- ============================================================================
