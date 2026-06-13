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
-- SEO Opportunities schema
-- ----------------------------------------------------------------------------
-- The persistent spine behind the SEO Opportunity Radar (/seo/opportunities).
-- One row per keyword opportunity. The /api/seo/opportunities/sync job pulls
-- SEMrush gaps, runs the relevance filter + classifier + dedupe, and upserts
-- here (idempotent on `keyword`). The Radar reads this table, so acting on a
-- keyword (Create Brief / Dismiss) changes `status` and the row leaves the
-- default "new" list — i.e. the module gains memory.
--
-- `keyword` is stored normalized (trimmed, lower-cased) so it can be the
-- conflict target for upserts and so dedupe is consistent.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.seo_opportunities (
  id                       uuid primary key default gen_random_uuid(),

  -- Identity (normalized: trimmed + lower-cased before insert)
  keyword                  text not null unique,
  source                   text not null default 'quickwin',  -- "quickwin" | "missing" | "longtail"
  competitor               text,                               -- gap source domain, if any

  -- SEMrush metrics
  search_volume            integer,
  keyword_difficulty       numeric,
  cpc                      numeric,
  our_position             integer,
  competitor_position      integer,

  -- Classification (Phase B; nullable so Phase A can ship first)
  intent                   text,    -- "informational" | "commercial" | "proof"
  practice_area            text,    -- "employment" | "collections"
  pillar_id                text,
  recommended_content_type text,    -- "practice_page" | "blog_post" | "case_result"

  -- Relevance filter (Phase A)
  relevance_score          integer not null default 0,  -- 0-100
  excluded                 boolean not null default false,
  exclude_reason           text,
  flags                    jsonb not null default '[]'::jsonb,

  -- Dedupe (Phase B): the existing KM page already covering this term, if any
  existing_url             text,

  -- Lifecycle
  status                   text not null default 'new',
    -- "new" | "brief" | "in_production" | "published" | "dismissed"
  brief_id                 uuid,    -- brief_suggestions.id once a brief is built
  draft_id                 uuid,    -- content_drafts.id once generated
  decision_notes           text,

  -- Raw metrics snapshot for the UI
  metrics                  jsonb not null default '{}'::jsonb,

  last_synced_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.seo_opportunities enable row level security;

drop policy if exists "auth read seo_opportunities"
  on public.seo_opportunities;
create policy "auth read seo_opportunities"
  on public.seo_opportunities
  for select
  to authenticated
  using (true);

-- Indexes for the Radar list + filters
create index if not exists seo_opportunities_status_idx
  on public.seo_opportunities (status);
create index if not exists seo_opportunities_excluded_idx
  on public.seo_opportunities (excluded);
create index if not exists seo_opportunities_relevance_idx
  on public.seo_opportunities (relevance_score desc);
create index if not exists seo_opportunities_practice_area_idx
  on public.seo_opportunities (practice_area);
create index if not exists seo_opportunities_created_idx
  on public.seo_opportunities (created_at desc);
