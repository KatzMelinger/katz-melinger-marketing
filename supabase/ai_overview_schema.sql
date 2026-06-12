-- ============================================================================
-- AI Overview tracking on seo_keywords
-- ----------------------------------------------------------------------------
-- Records, per tracked keyword, whether Google shows an AI Overview for it and
-- whether the firm's domain is cited inside that overview — so the team can see
-- where AI answers may be intercepting clicks (and where we're/aren't in them).
-- Populated by the tracked-keyword refresh via DataForSEO's SERP advanced
-- endpoint. Additive + idempotent.
-- ============================================================================

alter table public.seo_keywords
  add column if not exists ai_overview_present boolean;          -- AI Overview shown for this keyword
alter table public.seo_keywords
  add column if not exists ai_overview_cited boolean;            -- our domain cited in the overview
alter table public.seo_keywords
  add column if not exists ai_overview_sources jsonb not null default '[]'::jsonb; -- domains cited
alter table public.seo_keywords
  add column if not exists ai_overview_checked_at timestamptz;

create index if not exists seo_keywords_ai_overview_idx
  on public.seo_keywords (tenant_id, ai_overview_present);
