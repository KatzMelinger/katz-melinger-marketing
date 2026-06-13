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
-- Content Studio — reusable skill packs that train every generation
-- ============================================================================
-- Skills are short, named training snippets the firm wants every Content Studio
-- generation to honor — voice rules, do/don't lists, example phrasings, recurring
-- practice-area facts. They're injected into the system prompt for /api/content/draft
-- and /api/content/batch alongside brand voice notes and the brand profile.
--
-- Enabled = true means "include this skill in every generation."
-- Sort order = lower number wins (controls the order skills appear in prompts).
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- ============================================================================

create table if not exists public.content_skills (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  skill_type      text not null check (
    skill_type in (
      'voice_rule',
      'do_dont',
      'example_phrasing',
      'practice_fact',
      'compliance',
      'other'
    )
  ),
  content         text not null,
  enabled         boolean not null default true,
  sort_order      integer not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists content_skills_enabled_idx
  on public.content_skills (enabled, sort_order);
create index if not exists content_skills_type_idx
  on public.content_skills (skill_type);

alter table public.content_skills enable row level security;

drop policy if exists "auth read content_skills" on public.content_skills;
create policy "auth read content_skills"
  on public.content_skills
  for select
  to authenticated
  using (true);

drop policy if exists "auth write content_skills" on public.content_skills;
create policy "auth write content_skills"
  on public.content_skills
  for all
  to authenticated
  using (true)
  with check (true);
