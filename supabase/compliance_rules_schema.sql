-- ============================================================================
-- Ad-compliance knowledge base — per-jurisdiction rules + disclaimer library.
-- ============================================================================
-- Powers the data-driven ad-compliance checker (lib/ads-compliance.ts) and the
-- new Content Standards tabs on /brand-voice (State Rules, Disclaimers).
--
--   state_compliance_rules  — one row per US jurisdiction (50 states + DC).
--                             The attorney-advertising framework + key rules
--                             injected into the compliance prompt for that state.
--   compliance_disclaimers  — reusable disclaimer snippets (general or
--                             jurisdiction-scoped) the checker can require.
--
-- Both are tenant-scoped (Phase 4 multi-tenancy) and human/attorney-curated.
-- The State Rules can be AI-seeded for all 50 states + DC, then verified — every
-- seeded row lands as review_status='unverified'.
--
-- Idempotent. Run in the Supabase SQL editor (after the multitenancy phases,
-- which create public.tenants + public.current_tenant_id() + touch_updated_at).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- State Compliance Rules — attorney-advertising framework per jurisdiction.
-- ---------------------------------------------------------------------------
create table if not exists public.state_compliance_rules (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default '00000000-0000-0000-0000-000000000001'
                       references public.tenants(id),
  jurisdiction_code  text not null,                       -- 'NY','CA','DC', …
  jurisdiction_name  text not null,                       -- 'New York'
  governing_authority text,                               -- 'NY RPC, 22 NYCRR Part 1200'
  rules_summary      text,                                -- prose injected into the prompt
  key_rules          jsonb not null default '[]'::jsonb,  -- [{citation,rule,severity}]
  required_label     text,                                -- e.g. 'Attorney Advertising'
  notes              text,
  enabled            boolean not null default true,
  review_status      text not null default 'unverified' check (review_status in (
    'unverified',
    'verified',
    'needs_review',
    'archived'
  )),
  last_verified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One row per jurisdiction per tenant.
create unique index if not exists state_compliance_rules_tenant_code_idx
  on public.state_compliance_rules (tenant_id, jurisdiction_code);
create index if not exists state_compliance_rules_tenant_idx
  on public.state_compliance_rules (tenant_id);

-- ---------------------------------------------------------------------------
-- Compliance Disclaimers — reusable required-disclaimer snippets.
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_disclaimers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001'
                   references public.tenants(id),
  label          text not null,                           -- 'Prior results'
  text           text not null,                           -- the disclaimer copy
  jurisdiction   text,                                    -- 'general','NY','NJ', … (null = general)
  trigger        text,                                    -- when it's required, e.g. 'case results mentioned'
  practice_area  text,
  enabled        boolean not null default true,
  review_status  text not null default 'unverified' check (review_status in (
    'unverified',
    'verified',
    'needs_review',
    'archived'
  )),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists compliance_disclaimers_tenant_idx
  on public.compliance_disclaimers (tenant_id);
create index if not exists compliance_disclaimers_jurisdiction_idx
  on public.compliance_disclaimers (jurisdiction);

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped (same shape as multitenancy_phase4_research_libraries).
-- ---------------------------------------------------------------------------
do $$
declare t text; p text;
begin
  foreach t in array array['state_compliance_rules','compliance_disclaimers'] loop
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
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['state_compliance_rules','compliance_disclaimers'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format(
      'create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
