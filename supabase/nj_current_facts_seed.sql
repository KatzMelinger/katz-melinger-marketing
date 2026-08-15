-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- New Jersey wage figures — seed into the editable current_facts store
-- ============================================================================
-- getCurrentFacts() returns the DB rows INSTEAD of the code-seeded list whenever
-- the table has any row for the tenant — it is a replacement, not a merge. So a
-- tenant that already edited current facts on /settings/current-facts would
-- never see the NJ entries added to lib/current-facts.ts. This backfills them.
--
-- Values: NJDOL poster MW-570 (1/26), effective 2026-01-01. Same figures the
-- damages calculator uses (katz-melinger-cms app/lib/damages-rates.ts).
--
-- Only touches tenants that already have current_facts rows. If the table is
-- empty this inserts nothing and the code-seeded fallback already covers NJ.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- ============================================================================

insert into public.current_facts
  (fact_key, label, value, jurisdiction, effective_date, keywords, unit,
   source_url, re_verify_by, sort_order, tenant_id)
select
  f.fact_key, f.label, f.value, f.jurisdiction, f.effective_date, f.keywords,
  f.unit, f.source_url, f.re_verify_by, f.sort_order, t.tenant_id
from (values
  (
    'nj-min-wage-2026',
    'NJ minimum wage (most employers)',
    '$15.92 per hour',
    'New Jersey (employers with 6 or more employees)',
    '2026-01-01',
    array['minimum wage', 'min wage', 'hourly wage', 'wage rate', 'new jersey', 'n.j.'],
    'hour',
    'https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf',
    date '2027-01-01',
    40
  ),
  (
    -- No generic "minimum wage" keywords: both NJ rates would tie on a plain
    -- "New Jersey minimum wage" sentence and matchCurrentFact() returns nothing
    -- on a tie. The sentence has to say seasonal/small to select this rate.
    'nj-min-wage-small-employer-2026',
    'NJ minimum wage (seasonal and small employers)',
    '$15.23 per hour',
    'New Jersey (seasonal employers and employers with fewer than 6 employees)',
    '2026-01-01',
    array['new jersey', 'n.j.', 'seasonal employer', 'seasonal employers',
          'small employer', 'small employers', 'fewer than 6 employees',
          'fewer than six employees'],
    'hour',
    'https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf',
    date '2027-01-01',
    41
  ),
  (
    'nj-tipped-cash-wage-2026',
    'NJ cash wage for tipped workers',
    '$6.05 per hour',
    'New Jersey (maximum tip credit $9.87 for most employers)',
    '2026-01-01',
    array['tipped', 'tip credit', 'cash wage', 'tipped minimum wage', 'server',
          'new jersey', 'n.j.'],
    'hour',
    'https://www.nj.gov/labor/wageandhour/assets/PDFs/minimumwage_postcard.pdf',
    date '2027-01-01',
    42
  ),
  (
    -- Six years under the Wage Theft Act. No re_verify_by: unlike the wage
    -- rates, this does not change every January.
    'nj-wage-lookback',
    'NJ wage-claim statute of limitations (lookback)',
    '6 years',
    'New Jersey',
    '2019-08-06',
    array['statute of limitations', 'wage lookback', 'six-year', 'six years',
          '6 years', 'new jersey', 'n.j.', 'wage theft act'],
    '',
    'https://www.njleg.state.nj.us/bill-search/2018/A2903',
    null,
    43
  )
) as f (fact_key, label, value, jurisdiction, effective_date, keywords, unit,
        source_url, re_verify_by, sort_order)
-- tenant_id must be non-null: getCurrentFacts() filters on .eq("tenant_id", ...)
-- so a null-tenant row is never read, and null never conflicts with null, which
-- would make a re-run insert duplicates instead of doing nothing.
cross join (
  select distinct tenant_id
  from public.current_facts
  where tenant_id is not null
) as t
on conflict (tenant_id, lower(fact_key)) do nothing;

-- The NY lookback needs "new york" in its keywords now that NJ has a lookback
-- too: matchCurrentFact() suggests nothing when two facts tie, and without a
-- state keyword the two 6-year entries tie on any New York sentence.
update public.current_facts
set keywords  = (
      select array_agg(distinct k)
      from unnest(keywords || array['new york', 'n.y.']) as k
    ),
    updated_at = now()
where lower(fact_key) = 'ny-wage-lookback'
  and not (keywords @> array['new york']);
