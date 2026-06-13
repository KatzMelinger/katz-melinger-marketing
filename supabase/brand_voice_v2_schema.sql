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
-- Brand Voice v2 schema
-- ----------------------------------------------------------------------------
-- 1. brand_voice_avatars gains four optional columns
--    (demographics, pain_points, goals, channels).
-- 2. New brand_voice_samples table — example writings tagged by content
--    type (Blog Post, Social Media Post, Website Copy, etc.) that the AI
--    uses to learn tone for each format.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

alter table public.brand_voice_avatars
  add column if not exists demographics text,
  add column if not exists pain_points  text,
  add column if not exists goals        text,
  add column if not exists channels     text;

create table if not exists public.brand_voice_samples (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  content       text not null,
  content_type  text not null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.brand_voice_samples enable row level security;

drop policy if exists "auth read brand_voice_samples"
  on public.brand_voice_samples;
create policy "auth read brand_voice_samples"
  on public.brand_voice_samples
  for select
  to authenticated
  using (true);

create index if not exists brand_voice_samples_type_idx
  on public.brand_voice_samples (content_type);
create index if not exists brand_voice_samples_created_idx
  on public.brand_voice_samples (created_at desc);
