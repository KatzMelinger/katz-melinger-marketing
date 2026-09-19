-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL.
-- ============================================================================

-- ============================================================================
-- image_ocr_cache (spec 5.1 / E1) — caches the text extracted from an image
-- URL so the legal-accuracy check on a carousel slide/quote card doesn't pay
-- for a fresh vision-model call every time the post is re-gated (generation,
-- rewrite, approve, schedule all call the same gate). Keyed by the image URL
-- itself, since a saved image never changes in place.
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.image_ocr_cache (
  url             text primary key,
  tenant_id       uuid not null,
  extracted_text  text not null,
  created_at      timestamptz not null default now()
);

create index if not exists image_ocr_cache_tenant_idx on public.image_ocr_cache (tenant_id);

alter table public.image_ocr_cache enable row level security;

drop policy if exists "auth read image_ocr_cache" on public.image_ocr_cache;
create policy "auth read image_ocr_cache"
  on public.image_ocr_cache for select to authenticated using (true);

drop policy if exists "auth write image_ocr_cache" on public.image_ocr_cache;
create policy "auth write image_ocr_cache"
  on public.image_ocr_cache for all to authenticated using (true) with check (true);
