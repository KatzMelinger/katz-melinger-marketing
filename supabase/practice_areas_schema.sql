-- ============================================================================
-- Practice areas — editable, ordered list (replaces hardcoded lists)
-- ============================================================================
-- The canonical practice-area list, edited on /settings/practice-areas and
-- read by lib/practice-areas.ts (getPracticeAreas) + /api/practice-areas.
-- Replaces the lists that were hardcoded in lib/practice-areas.ts,
-- lib/firm-context.ts, and the Content Studio dropdowns.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.practice_areas (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness so "Severance" and "severance" can't both exist.
create unique index if not exists practice_areas_label_lower_idx
  on public.practice_areas (lower(label));

-- Seed a baseline only when the table is empty. Edit these in the app to your
-- real practice pages (and add the 6th) — no code change required.
insert into public.practice_areas (label, sort_order)
select v.label, v.sort_order
from (values
  ('Wage & Hour', 0),
  ('Discrimination', 1),
  ('Class Action', 2),
  ('Judgment Enforcement', 3),
  ('Severance', 4)
) as v(label, sort_order)
where not exists (select 1 from public.practice_areas);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.practice_areas enable row level security;

drop policy if exists "auth read practice_areas" on public.practice_areas;
create policy "auth read practice_areas"
  on public.practice_areas for select to authenticated using (true);
