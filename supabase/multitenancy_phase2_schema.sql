-- ============================================================================
-- Multi-tenancy — Phase 2: per-tenant config (tenant_settings).
-- ============================================================================
-- Moves the bits that are currently hardcoded for Katz Melinger into a
-- per-tenant settings row, so the app can serve ANY law firm:
--   - SEMRUSH domain + database
--   - Google Search Console site URL
--   - firm contact (name, address, phone, email, website) + target geography
--   - practice_areas + pillars (content taxonomy) — JSONB so they're editable
--   - system_prompt — the per-tenant content-generation system prompt
--
-- Fallback model: lib/tenant-config.ts reads this row and falls back to the
-- existing hardcoded constants whenever a field is null. The default tenant's
-- row is seeded with scalar values; practice_areas / pillars / system_prompt
-- are left NULL on purpose so the default tenant keeps using the code-defined
-- constants (avoids duplicating the big system prompt + pillar list in SQL).
--
-- Nothing changes behaviorally until Phase 4 (per-request tenant resolution);
-- until then everything resolves to the default tenant = current values.
--
-- Requires Phase 1 (tenants table). Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.tenant_settings (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  semrush_domain   text,
  semrush_database text,
  gsc_site_url     text,
  firm_name        text,
  firm_address     text,
  firm_phone       text,
  firm_email       text,
  firm_website     text,
  target_geography text,
  practice_areas   jsonb,          -- [{ "id": "...", "label": "..." }] or null → code default
  pillars          jsonb,          -- [{ "id","label","url","practiceArea" }] or null → code default
  system_prompt    text,           -- null → code-defined KM_SYSTEM_PROMPT
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.tenant_settings enable row level security;
drop policy if exists "auth read tenant_settings" on public.tenant_settings;
create policy "auth read tenant_settings"
  on public.tenant_settings for select to authenticated using (true);
drop policy if exists "auth write tenant_settings" on public.tenant_settings;
create policy "auth write tenant_settings"
  on public.tenant_settings for all to authenticated using (true) with check (true);

-- Seed the default Katz Melinger tenant with its current hardcoded scalars.
-- practice_areas / pillars / system_prompt stay NULL → code-defined defaults.
insert into public.tenant_settings (
  tenant_id, semrush_domain, semrush_database, gsc_site_url,
  firm_name, firm_address, firm_phone, firm_email, firm_website, target_geography
)
values (
  '00000000-0000-0000-0000-000000000001',
  'katzmelinger.com',
  'us',
  'https://katzmelinger.com/',
  'Katz Melinger PLLC',
  '370 Lexington Avenue, Suite 1512, New York, NY 10017',
  '(212) 460-0047',
  'info@katzmelinger.com',
  'www.KatzMelinger.com',
  'New York and New Jersey'
)
on conflict (tenant_id) do nothing;

drop trigger if exists tenant_settings_touch on public.tenant_settings;
create trigger tenant_settings_touch
  before update on public.tenant_settings
  for each row execute function public.touch_updated_at();
