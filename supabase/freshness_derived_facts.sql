-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Freshness Part 1 — region + time-unit tracking for salary thresholds
-- ----------------------------------------------------------------------------
-- Fixes the defect where ONE tracked field stood in for FOUR distinct facts:
-- the NY exempt salary threshold has a downstate and a rest-of-state value, and
-- each has a weekly and an annual form. With one field, the freshness panel
-- showed two identically-labelled rows and "Apply update" wrote the downstate
-- weekly figure into all four slots.
--
-- Adds:
--   1) derived_from / derived_multiplier — an annual figure is CALCULATED from
--      its weekly source (x 52), not independently sourced. Editing the weekly
--      value moves the annual one instead of leaving a second number to forget.
--      Derived values are exempt from re-verification: they are correct whenever
--      their source is correct.
--   2) The upstate weekly threshold + both annual figures.
--   3) NYSHRL / NYCHRL employer-size coverage thresholds, so the superseded
--      "four or more employees" claim is flagged instead of silently reused.
--
-- getCurrentFacts() returns the DB rows INSTEAD of the code-seeded list whenever
-- the table has any row for the tenant — it is a replacement, not a merge. So a
-- tenant that already edited current facts on /settings/current-facts would
-- never see entries added to lib/current-facts.ts. This backfills them.
--
-- Only touches tenants that already have current_facts rows. If the table is
-- empty this inserts nothing and the code-seeded fallback already covers it.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- 1) Derived-value columns ----------------------------------------------------
alter table public.current_facts
  add column if not exists derived_from       text;
alter table public.current_facts
  add column if not exists derived_multiplier numeric;

comment on column public.current_facts.derived_from is
  'fact_key this value is CALCULATED from (e.g. the weekly threshold behind an annual one). Null = independently sourced.';
comment on column public.current_facts.derived_multiplier is
  'Multiplier applied to the source amount. 52 for weekly -> annual.';

-- 2) Relabel the existing downstate weekly threshold ---------------------------
-- Was "NY executive/administrative exempt salary threshold (NYC + downstate)",
-- which does not say WEEKLY — so the annual row would have read identically.
update public.current_facts
set label      = 'NY exempt salary threshold — downstate, weekly',
    unit       = 'week',
    keywords   = (
      select array_agg(distinct k)
      from unnest(keywords || array['nassau', 'suffolk', 'westchester', 'long island']) as k
    ),
    updated_at = now()
where lower(fact_key) = 'ny-exempt-threshold-downstate-2026';

-- 3) The three missing NY threshold facts + employer-size thresholds -----------
insert into public.current_facts
  (fact_key, label, value, jurisdiction, effective_date, keywords, unit,
   source_url, re_verify_by, derived_from, derived_multiplier, sort_order, tenant_id)
select
  f.fact_key, f.label, f.value, f.jurisdiction, f.effective_date, f.keywords,
  f.unit, f.source_url, f.re_verify_by, f.derived_from, f.derived_multiplier,
  f.sort_order, t.tenant_id
from (values
  (
    'ny-exempt-threshold-upstate-2026',
    'NY exempt salary threshold — rest of state, weekly',
    '$1,199.10 per week',
    'Rest of New York State (outside NYC, Nassau, Suffolk, Westchester)',
    '2026-01-01',
    array['salary threshold', 'exempt threshold', 'salary basis',
          'exemption threshold', 'executive exemption', 'administrative exemption',
          'overtime exemption', 'exempt salary', 'salary level',
          'rest of new york', 'rest of the state', 'rest of state', 'upstate',
          'outside new york city', 'remainder of the state'],
    'week',
    '',
    date '2027-01-01',
    null::text,
    null::numeric,
    50
  ),
  (
    -- Annual = weekly x 52 exactly. recomputeDerived() re-evaluates this from
    -- the source on every load, so the literal below is a starting value, not a
    -- second number anyone has to maintain.
    'ny-exempt-threshold-downstate-annual-2026',
    'NY exempt salary threshold — downstate, annual',
    '$66,300.00 per year',
    'New York City and downstate counties (Nassau, Suffolk, Westchester)',
    '2026-01-01',
    array['salary threshold', 'exempt threshold', 'salary basis',
          'exemption threshold', 'executive exemption', 'administrative exemption',
          'overtime exemption', 'exempt salary', 'salary level',
          'new york city', 'nyc', 'downstate', 'nassau', 'suffolk',
          'westchester', 'long island'],
    'year',
    '',
    null::date,
    'ny-exempt-threshold-downstate-2026',
    52,
    51
  ),
  (
    'ny-exempt-threshold-upstate-annual-2026',
    'NY exempt salary threshold — rest of state, annual',
    '$62,353.20 per year',
    'Rest of New York State (outside NYC, Nassau, Suffolk, Westchester)',
    '2026-01-01',
    array['salary threshold', 'exempt threshold', 'salary basis',
          'exemption threshold', 'executive exemption', 'administrative exemption',
          'overtime exemption', 'exempt salary', 'salary level',
          'rest of new york', 'rest of the state', 'rest of state', 'upstate',
          'outside new york city', 'remainder of the state'],
    'year',
    '',
    null::date,
    'ny-exempt-threshold-upstate-2026',
    52,
    52
  ),
  (
    -- S.6577 removed the four-employee threshold entirely, effective 2020-02-08.
    'nyshrl-employer-size',
    'NYSHRL employer-size threshold',
    'all employers regardless of size',
    'New York State',
    '2020-02-08',
    array['nyshrl', 'new york state human rights law', 'human rights law',
          'employer size', 'four or more employees', '4 or more employees',
          'regardless of size', 'small employer'],
    '',
    'https://www.nysenate.gov/legislation/bills/2019/S6577',
    null::date,
    null::text,
    null::numeric,
    60
  ),
  (
    -- Int. 632-A, effective 2019-04-01. The four-or-more threshold still applies
    -- to OTHER NYCHRL protections — this row is harassment claims only.
    'nychrl-employer-size-harassment',
    'NYCHRL employer-size threshold — sexual/gender-based harassment',
    'employers of any size',
    'New York City (harassment claims only; the four-or-more threshold still applies to other NYCHRL protections)',
    '2019-04-01',
    array['nychrl', 'new york city human rights law', 'sexual harassment',
          'gender-based harassment', 'gender based harassment', 'employer size',
          'four or more employees', '4 or more employees', 'any size',
          'regardless of size'],
    '',
    'https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=3345349',
    null::date,
    null::text,
    null::numeric,
    61
  )
) as f (fact_key, label, value, jurisdiction, effective_date, keywords, unit,
        source_url, re_verify_by, derived_from, derived_multiplier, sort_order)
-- tenant_id must be non-null: getCurrentFacts() filters on .eq("tenant_id", ...)
-- so a null-tenant row is never read, and null never conflicts with null, which
-- would make a re-run insert duplicates instead of doing nothing.
cross join (
  select distinct tenant_id
  from public.current_facts
  where tenant_id is not null
) as t
on conflict (tenant_id, lower(fact_key)) do nothing;

-- 4) Verify --------------------------------------------------------------------
-- Expect four distinct NY threshold rows per tenant, each with its own label,
-- and the two annual rows pointing at their weekly source.
--
--   select fact_key, label, value, unit, derived_from, derived_multiplier
--   from public.current_facts
--   where fact_key like 'ny-exempt-threshold%'
--   order by tenant_id, sort_order;
