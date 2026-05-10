-- ============================================================================
-- Katz Melinger MarketOS — Paid Ads Schema
-- ============================================================================
-- Run this in the Supabase SQL editor before deploying the /ads section.
-- Creates four tables: ad_creatives, negative_keywords, ad_compliance_checks,
-- and ad_platform_accounts. RLS is enabled on all four; the service role
-- bypasses automatically so the API routes work normally.
-- ============================================================================

-- 1) Ad creatives ----------------------------------------------------------
-- Reusable ad copy + visuals, organized by platform and practice area.
-- Built up before launch so day-1 campaigns have vetted, compliant copy
-- ready to import into Google Ads / Microsoft Ads / Meta / LinkedIn.
create table if not exists public.ad_creatives (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  platform      text not null,           -- google_search, google_lsa, microsoft, meta, linkedin, youtube, tiktok, other
  format        text,                    -- search, display, video, social
  practice_area text,
  headline      text,
  description   text,
  body          text,
  cta           text,
  visual_url    text,                    -- Supabase Storage URL or Canva export URL
  notes         text,
  status        text not null default 'draft', -- draft, approved, paused, archived
  compliance_score integer,              -- last compliance check score 0-100
  compliance_checked_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ad_creatives_platform_idx
  on public.ad_creatives (platform);
create index if not exists ad_creatives_status_idx
  on public.ad_creatives (status);
create index if not exists ad_creatives_created_at_idx
  on public.ad_creatives (created_at desc);

alter table public.ad_creatives enable row level security;

-- 2) Negative keywords ------------------------------------------------------
-- Shared list across every campaign. When the firm launches Google Ads,
-- bulk-import these to avoid the typical first-month budget burn.
create table if not exists public.negative_keywords (
  id          uuid primary key default gen_random_uuid(),
  keyword     text not null,
  match_type  text not null default 'phrase',  -- exact, phrase, broad
  reason      text,
  source      text,  -- "manual", "ai-suggested", "imported"
  created_at  timestamptz not null default now()
);

create unique index if not exists negative_keywords_keyword_match_uniq
  on public.negative_keywords (lower(keyword), match_type);

create index if not exists negative_keywords_created_at_idx
  on public.negative_keywords (created_at desc);

alter table public.negative_keywords enable row level security;

-- 3) Ad compliance checks ---------------------------------------------------
-- History of every Claude-powered compliance review. Lets us track patterns
-- (which violations come up repeatedly) and surface stats on the Overview tab.
create table if not exists public.ad_compliance_checks (
  id            uuid primary key default gen_random_uuid(),
  creative_id   uuid references public.ad_creatives(id) on delete set null,
  ad_copy       text not null,
  platform      text,
  jurisdiction  text not null default 'NY,NJ',
  result        jsonb not null,  -- { score, violations[], warnings[], rewrites[], requiredDisclaimers[] }
  created_at    timestamptz not null default now()
);

create index if not exists ad_compliance_checks_created_at_idx
  on public.ad_compliance_checks (created_at desc);
create index if not exists ad_compliance_checks_creative_idx
  on public.ad_compliance_checks (creative_id);

alter table public.ad_compliance_checks enable row level security;

-- 4) Ad platform accounts --------------------------------------------------
-- One row per platform we might connect. Pre-seed with all five so the
-- Connections tab shows them all even before any are connected. When a
-- platform is connected, OAuth tokens / account IDs go in metadata.
create table if not exists public.ad_platform_accounts (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null unique,    -- google_ads, google_lsa, microsoft_ads, meta_ads, linkedin_ads
  display_name  text not null,
  status        text not null default 'not_connected', -- not_connected, connected, error
  account_id    text,
  account_name  text,
  metadata      jsonb,                   -- OAuth tokens, customer IDs, etc.
  connected_at  timestamptz,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.ad_platform_accounts enable row level security;

-- ============================================================================
-- RLS policies
-- ============================================================================
-- The MarketOS API routes use the service role key, which bypasses RLS.
-- These policies cover the case where an authenticated user reaches the
-- tables directly.

drop policy if exists "auth read ad_creatives" on public.ad_creatives;
create policy "auth read ad_creatives" on public.ad_creatives
  for select to authenticated using (true);

drop policy if exists "auth read negative_keywords" on public.negative_keywords;
create policy "auth read negative_keywords" on public.negative_keywords
  for select to authenticated using (true);

drop policy if exists "auth read ad_compliance_checks" on public.ad_compliance_checks;
create policy "auth read ad_compliance_checks" on public.ad_compliance_checks
  for select to authenticated using (true);

drop policy if exists "auth read ad_platform_accounts" on public.ad_platform_accounts;
create policy "auth read ad_platform_accounts" on public.ad_platform_accounts
  for select to authenticated using (true);

-- ============================================================================
-- Seed: pre-populate the five platforms so the Connections tab renders.
-- ============================================================================
insert into public.ad_platform_accounts (platform, display_name, status) values
  ('google_ads',     'Google Ads',           'not_connected'),
  ('google_lsa',     'Google Local Services', 'not_connected'),
  ('microsoft_ads',  'Microsoft Advertising', 'not_connected'),
  ('meta_ads',       'Meta (Facebook/Instagram)', 'not_connected'),
  ('linkedin_ads',   'LinkedIn Ads',         'not_connected')
on conflict (platform) do nothing;

-- A starter list of negative keywords every plaintiff employment law firm wants
-- to block on day one. Edit / extend from the Keywords tab.
insert into public.negative_keywords (keyword, match_type, reason, source) values
  ('free legal advice',    'phrase', 'Not our offering — we only handle paid representation', 'imported'),
  ('pro bono',             'phrase', 'We do not do pro bono work', 'imported'),
  ('volunteer lawyer',     'phrase', 'Not our offering', 'imported'),
  ('legal aid',            'phrase', 'Different category — non-profit legal aid', 'imported'),
  ('jobs',                 'phrase', 'Job seekers, not legal clients', 'imported'),
  ('hiring',               'phrase', 'Job seekers, not legal clients', 'imported'),
  ('salary',               'phrase', 'Job seekers, not legal clients', 'imported'),
  ('paralegal',            'phrase', 'Job seekers, not legal clients', 'imported'),
  ('law school',           'phrase', 'Students, not clients', 'imported'),
  ('bar exam',             'phrase', 'Students, not clients', 'imported'),
  ('legal memes',          'phrase', 'Irrelevant', 'imported'),
  ('public defender',      'phrase', 'Criminal — not our practice', 'imported'),
  ('criminal lawyer',      'phrase', 'Not our practice areas', 'imported'),
  ('dui',                  'phrase', 'Not our practice areas', 'imported'),
  ('divorce lawyer',       'phrase', 'Not our practice areas', 'imported'),
  ('immigration lawyer',   'phrase', 'Not our practice areas', 'imported'),
  ('personal injury',      'phrase', 'Not our practice areas', 'imported'),
  ('legal forms',          'phrase', 'DIY seekers, not clients', 'imported'),
  ('how to sue',           'phrase', 'Pro se researchers, not clients', 'imported'),
  ('represent myself',     'phrase', 'Pro se researchers, not clients', 'imported'),
  ('definition',           'phrase', 'Definitional searches, low intent', 'imported'),
  ('meaning',              'phrase', 'Definitional searches, low intent', 'imported'),
  ('wikipedia',            'broad',  'Reference seekers, not clients', 'imported'),
  ('reddit',               'broad',  'Forum browsing, low intent for legal services', 'imported')
on conflict do nothing;
