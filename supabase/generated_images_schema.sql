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
-- generated_images — persisted output of /api/images/generate + /api/images/edit
-- ============================================================================
-- The Image Generator at /content/images turns prompts into PNGs via OpenAI
-- gpt-image-1. The raw PNG goes to the storage bucket `generated-images`; this
-- table holds the prompt history + storage path + edit lineage so the page can
-- show a gallery and let the marketer iterate on a generation with a follow-up
-- prompt.
--
-- parent_image_id links an "edit" back to the image it was derived from, so
-- the gallery can render an edit chain ("variation of X").
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.generated_images (
  id              uuid primary key default gen_random_uuid(),
  prompt          text not null,
  size            text not null,                  -- e.g. '1024x1024'
  quality         text not null,                  -- 'low' | 'medium' | 'high' | 'auto'
  storage_path    text not null,                  -- key inside the generated-images bucket
  public_url      text not null,                  -- cached convenience for the UI
  parent_image_id uuid references public.generated_images(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists generated_images_created_idx
  on public.generated_images (created_at desc);
create index if not exists generated_images_parent_idx
  on public.generated_images (parent_image_id);

-- RLS — only authenticated users (dashboard) can read/write. The API routes
-- use the service role, so RLS doesn't gate them.
alter table public.generated_images enable row level security;

drop policy if exists "auth read generated_images" on public.generated_images;
create policy "auth read generated_images"
  on public.generated_images
  for select to authenticated using (true);

drop policy if exists "auth write generated_images" on public.generated_images;
create policy "auth write generated_images"
  on public.generated_images
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Storage bucket: generated-images
-- ----------------------------------------------------------------------------
-- Public bucket so the dashboard can render <img src=public_url />. Paths are
-- UUID-based so they're effectively unguessable; nothing here is sensitive
-- (user-typed prompts + AI output).

insert into storage.buckets (id, name, public)
values ('generated-images', 'generated-images', true)
on conflict (id) do update set public = excluded.public;
