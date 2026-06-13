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
-- Content pipeline — editorial workflow tracker
-- ============================================================================
-- Different from content_drafts (which stores AI-generated text). This table
-- tracks pieces of content as they move through the editorial pipeline:
-- Idea → Brief → Draft → Review → Published. Organized into 4 strategic
-- buckets so the team can balance their content mix.
--
-- Run this in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- Idempotent.
-- ============================================================================

create table if not exists public.content_pipeline (
  id           bigserial primary key,
  title        text not null,
  keywords     text,
  location     text,
  status       text not null default 'idea'
                check (status in ('idea', 'brief', 'draft', 'review', 'published')),
  bucket       text not null default 'bofu_education'
                check (bucket in ('money_page', 'bofu_education', 'mofu_trust', 'local_authority')),
  notes        text,
  url          text,
  -- Optional link to a content_drafts row once a draft has been generated.
  draft_id     uuid references public.content_drafts (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists content_pipeline_status_idx on public.content_pipeline (status);
create index if not exists content_pipeline_bucket_idx on public.content_pipeline (bucket);
create index if not exists content_pipeline_updated_at_idx on public.content_pipeline (updated_at desc);

alter table public.content_pipeline enable row level security;

drop policy if exists "auth read content_pipeline" on public.content_pipeline;
create policy "auth read content_pipeline"
  on public.content_pipeline
  for select
  to authenticated
  using (true);

-- Auto-bump updated_at on any change.
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_content_pipeline_updated on public.content_pipeline;
create trigger touch_content_pipeline_updated
  before update on public.content_pipeline
  for each row execute function public.tg_touch_updated_at();
