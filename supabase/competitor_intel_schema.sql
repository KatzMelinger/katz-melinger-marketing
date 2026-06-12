-- ============================================================================
-- Competitor intelligence (paid ads) — metering spine + live-ad cache/history.
-- ============================================================================
-- Powers the /ads "Competitor Intel" tab (lib/competitor-ads.ts) and the
-- provider-agnostic usage meter (lib/usage-meter.ts).
--
--   external_api_usage     — per-tenant ledger: one row per metered external
--                            call (and per cache hit, with units=0). The source
--                            of truth for "how much of the owner's API budget
--                            has this client spent this month".
--   tenant_usage_limits    — per-tenant monthly cap per meter. Lazily seeded
--                            with a default cap when a tenant first hits a meter.
--   competitor_ad_snapshots— per-tenant history of pulled competitor ads, so the
--                            tab can show last results instantly + future diffing.
--
-- Live ad data comes from DataForSEO SERP API (serp/google/ads_search), so the
-- response cache is the EXISTING public.dataforseo_cache — no separate cache
-- table here. That global cache is the cross-tenant dedup/margin lever: two
-- firms looking up the same advertiser share one paid request.
--
-- Tenant-scoped tables follow the Phase-4 convention (see
-- supabase/compliance_rules_schema.sql): tenant_id default + RLS via
-- public.current_tenant_id(), touch_updated_at trigger where a row is updated.
--
-- Idempotent. Run in the Supabase SQL editor (after the multitenancy phases,
-- which create public.tenants + public.current_tenant_id() + touch_updated_at).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- external_api_usage — per-tenant metered-call ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.external_api_usage (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001'
                   references public.tenants(id),
  provider       text not null,                          -- 'dataforseo', …
  endpoint       text not null,                          -- e.g. 'google_ads_transparency_center'
  meter          text not null default 'competitor_lookup', -- which quota bucket this counts against
  units          integer not null default 1,             -- billable units; 0 for a cache hit
  est_cost_cents integer not null default 0,             -- rough cost estimate, for reporting
  cache_hit      boolean not null default false,
  detail         text,                                   -- free-form (e.g. the competitor domain)
  created_at     timestamptz not null default now()
);

create index if not exists external_api_usage_tenant_created_idx
  on public.external_api_usage (tenant_id, created_at desc);
create index if not exists external_api_usage_tenant_meter_idx
  on public.external_api_usage (tenant_id, meter, created_at desc);

-- ---------------------------------------------------------------------------
-- tenant_usage_limits — per-tenant monthly cap per meter.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_usage_limits (
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                 references public.tenants(id),
  meter        text not null,                            -- 'competitor_lookup', …
  monthly_cap  integer not null default 100,             -- billable units allowed per calendar month
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, meter)
);

-- ---------------------------------------------------------------------------
-- competitor_ad_snapshots — per-tenant history of pulled competitor ads.
-- ---------------------------------------------------------------------------
create table if not exists public.competitor_ad_snapshots (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.tenants(id),
  competitor_domain text not null,
  advertiser_id     text,
  ad_count          integer not null default 0,
  snapshot          jsonb not null default '[]'::jsonb,   -- normalized ad list
  created_at        timestamptz not null default now()
);

create index if not exists competitor_ad_snapshots_tenant_created_idx
  on public.competitor_ad_snapshots (tenant_id, created_at desc);
create index if not exists competitor_ad_snapshots_tenant_domain_idx
  on public.competitor_ad_snapshots (tenant_id, competitor_domain);

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped tables only.
-- ---------------------------------------------------------------------------
do $$
declare t text; p text;
begin
  foreach t in array array['external_api_usage','tenant_usage_limits','competitor_ad_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared function, defined by earlier schemas).
-- Only tenant_usage_limits has a mutable updated_at.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists tenant_usage_limits_touch on public.tenant_usage_limits';
  execute 'create trigger tenant_usage_limits_touch before update on public.tenant_usage_limits for each row execute function public.touch_updated_at()';
end $$;
