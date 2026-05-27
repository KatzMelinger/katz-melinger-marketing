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
