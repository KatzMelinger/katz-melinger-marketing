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
-- Rendered video pipeline — async render jobs + media storage
-- ============================================================================
-- Turns a video-script draft (content_drafts.format = video_short | video_long)
-- into a rendered video file via a swappable provider (HeyGen, ElevenLabs, …;
-- a `stub` provider ships by default). Renders are async, so each row tracks a
-- vendor job through queued → rendering → succeeded | failed.
--
--   * video_renders   — one row per render attempt for a draft
--   * storage bucket  — `video-renders` holds the finished .mp4 files
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- 1) Render jobs -------------------------------------------------------------
create table if not exists public.video_renders (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid references public.content_drafts (id) on delete cascade,
  provider          text not null,                              -- stub | heygen | elevenlabs | …
  provider_job_id   text,                                       -- the vendor's async job handle
  status            text not null default 'queued'
                      check (status in ('queued', 'rendering', 'succeeded', 'failed')),
  options           jsonb not null default '{}'::jsonb,         -- voiceId, avatarId, aspectRatio, captions, …
  output_url        text,                                       -- playable URL once succeeded
  storage_path      text,                                       -- path in the video-renders bucket (when persisted)
  duration_seconds  numeric,
  cost_cents        integer,                                    -- per-render cost for the spend ledger
  error             text,                                       -- vendor error when failed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists video_renders_draft_idx on public.video_renders (draft_id);
create index if not exists video_renders_status_idx on public.video_renders (status);
create index if not exists video_renders_created_at_idx on public.video_renders (created_at desc);

-- 2) Storage bucket for finished files ---------------------------------------
-- Public bucket so output_url is directly playable. Switch to private + signed
-- URLs if renders should not be world-readable.
insert into storage.buckets (id, name, public)
values ('video-renders', 'video-renders', true)
on conflict (id) do nothing;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.video_renders enable row level security;

drop policy if exists "auth read video_renders" on public.video_renders;
create policy "auth read video_renders"
  on public.video_renders for select to authenticated using (true);
