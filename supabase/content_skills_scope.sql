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
-- content_skills — scoping by platform / audience / practice area
-- ============================================================================
-- A skill can now be targeted at:
--   * specific platforms (blog, linkedin, twitter, facebook, instagram,
--     email, podcast) — where the content is being published
--   * specific audience avatars (free-text names matching brand_voice_avatars)
--   * specific practice areas (Wage & Hour, Discrimination, Class Action,
--     Judgment Enforcement, Severance, etc.)
--
-- All three columns are nullable arrays. An empty / null array means
-- "applies everywhere" so existing skills keep working unchanged.
--
-- buildSkillsContext() in lib/content-skills.ts filters skills against the
-- scope of the current generation. A scoped skill only fires when the
-- generation's scope satisfies every set dimension.
--
-- Two new skill types are added — 'prompt' and 'direction' — so users
-- can store raw instructions and looser content direction alongside the
-- existing voice rules / do-dont / etc.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

alter table public.content_skills
  add column if not exists platforms text[];
alter table public.content_skills
  add column if not exists audiences text[];
alter table public.content_skills
  add column if not exists practice_areas text[];

alter table public.content_skills
  drop constraint if exists content_skills_skill_type_check;
alter table public.content_skills
  add constraint content_skills_skill_type_check
    check (skill_type in (
      'voice_rule',
      'do_dont',
      'example_phrasing',
      'practice_fact',
      'compliance',
      'prompt',
      'direction',
      'other'
    ));

create index if not exists content_skills_platforms_idx
  on public.content_skills using gin (platforms);
create index if not exists content_skills_audiences_idx
  on public.content_skills using gin (audiences);
create index if not exists content_skills_practice_areas_idx
  on public.content_skills using gin (practice_areas);
