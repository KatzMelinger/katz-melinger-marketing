-- ============================================================================
-- Katz Melinger MarketOS — Legal Directories + Citations schema
-- ============================================================================
-- Backs two SEO sidebar surfaces:
--   1) seo_legal_directories — a tracker of legal-specific directories (Avvo,
--      Justia, FindLaw, Martindale, state bar, etc.) and the firm's listing
--      status on each. AI suggests which directories matter for the practice
--      areas; the team manages status by hand.
--   2) seo_citations — local NAP (name / address / phone) consistency tracking
--      across general + local citation sources. Canonical NAP comes from the
--      tenant's brand-voice/firm config; each row records what's actually live
--      on a given source so mismatches surface.
--
-- Hybrid by design: today both are manual + AI-assisted (no per-call API cost).
-- The `source` column leaves a seam for a later DataForSEO Business Listings
-- "scan" to populate rows automatically without schema changes.
--
-- Both tables are tenant-scoped with the same RLS pattern as ads_phase2_schema
-- (service role bypasses RLS; authenticated clients are restricted to their
-- own tenant). Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- Default tenant id (Katz Melinger): 00000000-0000-0000-0000-000000000001

-- 1) Legal directories ------------------------------------------------------
create table if not exists public.seo_legal_directories (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                 references public.tenants(id) on delete cascade,
  name         text not null,                     -- "Avvo", "Justia", "NY State Bar"
  url          text,                              -- directory homepage
  category     text not null default 'general',   -- general | practice | local | bar
  status       text not null default 'not_listed',-- not_listed | in_progress | listed | claimed | needs_update
  listing_url  text,                              -- the firm's actual profile URL
  priority     text not null default 'medium',    -- high | medium | low
  notes        text,
  source       text not null default 'manual',    -- manual | suggested | scan
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One row per directory name per tenant. Plain-column unique (not lower(name))
-- so the app's upsert onConflict "tenant_id,name" can target it — PostgREST
-- can't match an expression index. The app trims the name before insert.
-- drop the older expression index by name if a previous run created it.
drop index if exists public.seo_legal_directories_tenant_name_uniq;
create unique index if not exists seo_legal_directories_tenant_name_uniq
  on public.seo_legal_directories (tenant_id, name);
create index if not exists seo_legal_directories_status_idx
  on public.seo_legal_directories (tenant_id, status);

alter table public.seo_legal_directories enable row level security;

-- 2) Citations (NAP) --------------------------------------------------------
create table if not exists public.seo_citations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                 references public.tenants(id) on delete cascade,
  source       text not null,                     -- "Google Business Profile", "Yelp", "Bing Places"
  listing_url  text,
  nap_name     text,                              -- name as it appears on this source
  nap_address  text,                              -- address as it appears
  nap_phone    text,                              -- phone as it appears
  status       text not null default 'unverified',-- consistent | inconsistent | missing | unverified
  issues       text,                              -- what differs from canonical NAP
  source_type  text not null default 'manual',    -- manual | audit | scan
  last_checked_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Plain-column unique so the app upsert onConflict "tenant_id,source" matches.
drop index if exists public.seo_citations_tenant_source_uniq;
create unique index if not exists seo_citations_tenant_source_uniq
  on public.seo_citations (tenant_id, source);
create index if not exists seo_citations_status_idx
  on public.seo_citations (tenant_id, status);

alter table public.seo_citations enable row level security;

-- ============================================================================
-- Tenant-scoped RLS policies (same shape as ads_phase2_schema.sql)
-- ============================================================================
do $$
declare t text; p text;
begin
  foreach t in array array['seo_legal_directories','seo_citations'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
