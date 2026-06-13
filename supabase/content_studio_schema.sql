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
-- Content Studio — drafts library, multi-format batches, analysis, sources
-- ============================================================================
-- Adds tables for the expanded /content section:
--   * content_drafts        — every generation autosaves; revisit / re-edit
--   * content_batches       — one topic → many formats (blog, LinkedIn,
--                             Twitter, email, podcast) generated together
--   * content_analyses      — readability, keyword density, AEO score,
--                             brand-voice match scored after generation
--   * content_sources       — uploaded text, URLs, or files we want to
--                             review for improvements or repurpose
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

-- 1) Content drafts ----------------------------------------------------------
create table if not exists public.content_drafts (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid,                                       -- nullable; set when part of a multi-format batch
  format          text not null,                              -- blog | linkedin | twitter | facebook | instagram | email | podcast
  template        text,                                       -- e.g. blog_general, case_study, podcast_solo
  topic           text not null,
  practice_area   text,
  title           text,
  body            text not null,
  metadata        jsonb not null default '{}'::jsonb,         -- subject, hashtags, length, tone, platform, etc
  seo_brief       jsonb,                                      -- snapshot of the SEO brief used at generation time
  source_id       uuid,                                       -- nullable; set when generated from an uploaded source
  status          text not null default 'draft' check (status in ('draft', 'approved', 'published', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists content_drafts_created_at_idx on public.content_drafts (created_at desc);
create index if not exists content_drafts_format_idx on public.content_drafts (format);
create index if not exists content_drafts_batch_idx on public.content_drafts (batch_id);
create index if not exists content_drafts_status_idx on public.content_drafts (status);

-- 2) Multi-format batches ----------------------------------------------------
-- One row per "type a topic, get every format at once" generation. Lets the UI
-- group the resulting drafts together.
create table if not exists public.content_batches (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,
  practice_area   text,
  formats         jsonb not null default '[]'::jsonb,         -- which formats were requested
  source_id       uuid,                                       -- if generated from an uploaded source
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists content_batches_created_at_idx on public.content_batches (created_at desc);

-- 3) Post-generation analysis -----------------------------------------------
-- Per-draft scoring so the user can see if a draft is too dense, off-brand,
-- or unlikely to be cited by AI before publishing.
create table if not exists public.content_analyses (
  id                     uuid primary key default gen_random_uuid(),
  draft_id               uuid references public.content_drafts (id) on delete cascade,
  readability_score      integer,                              -- 0-100 (Flesch reading ease, normalized)
  reading_grade_level    numeric,
  word_count             integer,
  sentence_count         integer,
  keyword_density        jsonb not null default '{}'::jsonb,   -- { "wage theft": 4, "nyc": 7, ... }
  target_keyword_hits    jsonb not null default '{}'::jsonb,   -- which SEO-brief keywords appear and how often
  aeo_score              integer,                              -- 0-100, citation-worthiness for AI engines
  aeo_findings           jsonb not null default '[]'::jsonb,   -- specific improvements
  brand_voice_score      integer,                              -- 0-100, alignment with firm voice
  brand_voice_findings   jsonb not null default '[]'::jsonb,
  summary                text,
  created_at             timestamptz not null default now()
);

create index if not exists content_analyses_draft_idx on public.content_analyses (draft_id);

-- 4) Source materials --------------------------------------------------------
-- Uploaded text, URLs, or files the user wants to review for improvements or
-- repurpose into other formats (e.g., a blog → LinkedIn post).
create table if not exists public.content_sources (
  id              uuid primary key default gen_random_uuid(),
  source_type     text not null check (source_type in ('text', 'url', 'file')),
  filename        text,                                       -- for files
  url             text,                                       -- for URL sources
  content         text not null,                              -- raw extracted text (always populated)
  word_count      integer not null default 0,
  notes           text,
  review_summary  jsonb,                                      -- AI's analysis of the source: strengths, gaps, suggestions
  created_at      timestamptz not null default now()
);

create index if not exists content_sources_created_at_idx on public.content_sources (created_at desc);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.content_drafts enable row level security;
alter table public.content_batches enable row level security;
alter table public.content_analyses enable row level security;
alter table public.content_sources enable row level security;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'content_drafts','content_batches','content_analyses','content_sources'
    ])
  loop
    execute format('drop policy if exists "auth read %I" on public.%I;', t, t);
    execute format(
      'create policy "auth read %I" on public.%I for select to authenticated using (true);',
      t, t
    );
  end loop;
end$$;
