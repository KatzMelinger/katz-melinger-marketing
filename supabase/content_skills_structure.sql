-- ============================================================================
-- content_skills — structure rules + content-type scoping
-- ============================================================================
-- Adds first-class support for *structure* directions (word limits, required
-- sections, required elements) alongside the existing voice rules / prompts /
-- directions, and adds a new content_type scope dimension so a direction can
-- be targeted at "Blog Post", "FAQ", "Practice Page", "Case Study", etc.
-- independently of the social/email platform scope.
--
-- New columns:
--   * content_types     text[]   nullable — scope by content type
--   * max_words         integer  nullable — only meaningful for skill_type='structure'
--   * sections          text[]   nullable — ordered list of required section headers
--   * required_elements text[]   nullable — must-have elements (CTA, disclaimer, etc.)
--
-- The skill_type CHECK constraint is updated to include 'structure'.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project after content_skills_scope.sql.
-- ============================================================================

alter table public.content_skills
  add column if not exists content_types text[];

alter table public.content_skills
  add column if not exists max_words integer;

alter table public.content_skills
  add column if not exists sections text[];

alter table public.content_skills
  add column if not exists required_elements text[];

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
      'structure',
      'other'
    ));

create index if not exists content_skills_content_types_idx
  on public.content_skills using gin (content_types);
