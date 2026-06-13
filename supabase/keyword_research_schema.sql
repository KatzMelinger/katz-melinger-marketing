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
-- Katz Melinger MarketOS — Keyword Research Schema
-- ============================================================================
-- Run this in the Supabase SQL editor before deploying the keyword research
-- feature. Creates three tables: brand_voice_settings, brand_voice_avatars,
-- and seo_keywords. RLS is enabled on all three; the service role bypasses
-- automatically so the API routes work normally.
-- ============================================================================

-- 1) Brand voice settings ---------------------------------------------------
-- Simple key/value store for firm-level context strings (e.g. keyMessages,
-- toneOfVoice, targetGeography). Used by the AI keyword research routes to
-- personalize prompts.
create table if not exists public.brand_voice_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.brand_voice_settings enable row level security;

-- 2) Brand voice avatars -----------------------------------------------------
-- Target-audience personas. Used by the AI prompts to tailor content
-- suggestions toward the kinds of clients the firm wants to attract.
create table if not exists public.brand_voice_avatars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.brand_voice_avatars enable row level security;

-- 3) SEO keywords (tracked) --------------------------------------------------
-- Keywords the firm is actively tracking. The /api/seo/keywords/refresh
-- endpoint pulls live position/volume/difficulty data from Semrush and
-- updates these rows. previous_rank is preserved so the UI can show movement.
create table if not exists public.seo_keywords (
  id              uuid primary key default gen_random_uuid(),
  keyword         text not null unique,
  practice_area   text,
  notes           text,
  current_rank    integer,
  previous_rank   integer,
  search_volume   integer,
  difficulty      integer,
  url             text,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists seo_keywords_created_at_idx
  on public.seo_keywords (created_at);

alter table public.seo_keywords enable row level security;

-- ============================================================================
-- RLS policies
-- ============================================================================
-- The MarketOS API routes use the service role key, which bypasses RLS.
-- These policies cover the case where an authenticated user reaches the
-- tables directly (e.g. via the Supabase JS client on the client side).
-- Adjust to your auth model if you later add per-user scoping.

drop policy if exists "auth read brand_voice_settings"
  on public.brand_voice_settings;
create policy "auth read brand_voice_settings"
  on public.brand_voice_settings
  for select
  to authenticated
  using (true);

drop policy if exists "auth read brand_voice_avatars"
  on public.brand_voice_avatars;
create policy "auth read brand_voice_avatars"
  on public.brand_voice_avatars
  for select
  to authenticated
  using (true);

drop policy if exists "auth read seo_keywords"
  on public.seo_keywords;
create policy "auth read seo_keywords"
  on public.seo_keywords
  for select
  to authenticated
  using (true);

-- ============================================================================
-- Seed data (optional)
-- ============================================================================
-- Pre-populate the firm context so keyword research has something to work
-- with on day one. Edit freely from the Brand Voice page in MarketOS later.

insert into public.brand_voice_settings (key, value) values
  ('firmName', 'Katz Melinger PLLC'),
  ('targetGeography', 'New York City and New Jersey'),
  ('keyMessages',
   'Plaintiff-side employment law firm. We fight for workers in wage & hour, '
   'discrimination, harassment, wrongful termination, and severance matters. '
   'We also handle commercial collections and judgment enforcement.'),
  ('toneOfVoice',
   'Confident, plain-spoken, accessible. Avoid legalese. Speak directly to '
   'workers who feel they have been wronged.')
on conflict (key) do nothing;

insert into public.brand_voice_avatars (name, role, description) values
  ('Hourly Worker',
   'Restaurant / retail / warehouse employee',
   'Earning at or near minimum wage. Often unpaid for overtime, off-the-clock '
   'work, or denied tips. Frequently Spanish-speaking. Needs reassurance that '
   'consultations are free and confidential.'),
  ('Salaried Professional',
   'Mid-career office worker',
   'Earning $75K–$200K. Concerned about retaliation, severance terms, '
   'discrimination, or hostile work environment. Wants clear answers about '
   'rights and likely outcomes before deciding to act.'),
  ('Small Business Owner',
   'Creditor with unpaid invoices or unsatisfied judgments',
   'Needs help collecting from a debtor or domesticating an out-of-state '
   'judgment. Values speed and concrete results over hand-holding.')
on conflict do nothing;
