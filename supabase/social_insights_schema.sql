-- ============================================================================
-- !! DB TARGET CHECK — run against the LIVE marketing-SaaS Supabase project
-- (the one .env.local's NEXT_PUBLIC_SUPABASE_URL points at). Confirm the ref in
-- the dashboard URL before running.
-- ============================================================================

-- ============================================================================
-- social_insights — manually-curated inputs for the Trends & Performance screen
-- ----------------------------------------------------------------------------
-- Some of Screen 3 isn't available from the Metricool API (audience age/cities
-- demographics, and the editorial "Hot/Warm/Growing" topic read + the monthly
-- content suggestion). This table lets the team enter that info IN the system so
-- the screen shows it alongside the auto, Metricool-derived performance data.
--
-- One row per tenant. JSON shapes:
--   audience   { "ageGroups": [{"label":"25-34","pct":38}], "topCities": [{"name":"New York","pct":42}] }
--   topics     [ {"topic":"RTO accommodations","status":"hot"}, ... ]   status ∈ hot|warm|growing
--   suggestion free text — the recommended focus for next month
--
-- Tenant-aware with RLS, matching the Phase-4 pattern. Idempotent.
-- ============================================================================

create table if not exists public.social_insights (
  tenant_id  uuid primary key,
  audience   jsonb not null default '{}'::jsonb,
  topics     jsonb not null default '[]'::jsonb,
  suggestion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_insights enable row level security;

drop policy if exists "tenant rw social_insights" on public.social_insights;
create policy "tenant rw social_insights"
  on public.social_insights
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Auto-bump updated_at (shared trigger fn; create-or-replace keeps this file
-- runnable standalone).
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_social_insights_updated on public.social_insights;
create trigger touch_social_insights_updated
  before update on public.social_insights
  for each row execute function public.tg_touch_updated_at();
