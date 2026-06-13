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
-- image_style_settings — brand-style guide for the image generator
-- ============================================================================
-- Same idea as brand_voice_settings but for visual generation: stores the
-- firm's preferred photography/illustration direction, color palette, mood,
-- composition rules, and an explicit "avoid" list. Applied automatically as
-- a prompt suffix by /api/images/generate and /api/images/edit when the
-- caller doesn't opt out.
--
-- Single-row-per-key key/value table — same shape as brand_voice_settings so
-- the UI patterns stay consistent. Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.image_style_settings (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.image_style_settings enable row level security;

drop policy if exists "auth read image_style_settings" on public.image_style_settings;
create policy "auth read image_style_settings"
  on public.image_style_settings
  for select to authenticated using (true);

drop policy if exists "auth write image_style_settings" on public.image_style_settings;
create policy "auth write image_style_settings"
  on public.image_style_settings
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- image_style_channels — per-channel style notes (sub-styles)
-- ============================================================================
-- The general guide above applies to everything. These rows hold a single
-- free-form notes block per marketing channel/subsection (social carousels,
-- social posts, blog, website, newsletter). On generation the selected
-- channel's notes are appended to the general guide.
--
-- `channel` is one of: 'social_carousel' | 'social_post' | 'blog' |
-- 'website' | 'newsletter' (the 'general' guide lives in the key/value table
-- above, not here). One row per channel. Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.image_style_channels (
  channel     text primary key,
  notes       text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.image_style_channels enable row level security;

drop policy if exists "auth read image_style_channels" on public.image_style_channels;
create policy "auth read image_style_channels"
  on public.image_style_channels
  for select to authenticated using (true);

drop policy if exists "auth write image_style_channels" on public.image_style_channels;
create policy "auth write image_style_channels"
  on public.image_style_channels
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- image_style_assets — uploaded design-reference files per channel
-- ============================================================================
-- Real on-brand design files the marketer uploads (PNG/JPEG/WEBP). When a
-- channel has assets, /api/images/generate forwards them to gpt-image-1's
-- edits endpoint as visual references (image[]) so output matches the look.
--
-- Bytes live in the EXISTING `generated-images` storage bucket under a
-- `style-references/<channel>/` prefix — no new bucket is required. This table
-- only records pointers + metadata. Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.image_style_assets (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null,
  storage_path  text not null,
  public_url    text not null,
  filename      text,
  content_type  text,
  created_at    timestamptz not null default now()
);

create index if not exists image_style_assets_channel_idx
  on public.image_style_assets (channel, created_at desc);

alter table public.image_style_assets enable row level security;

drop policy if exists "auth read image_style_assets" on public.image_style_assets;
create policy "auth read image_style_assets"
  on public.image_style_assets
  for select to authenticated using (true);

drop policy if exists "auth write image_style_assets" on public.image_style_assets;
create policy "auth write image_style_assets"
  on public.image_style_assets
  for all to authenticated using (true) with check (true);
