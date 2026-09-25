-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Fix the pillar URLs, and restore the missing employment hub (Diana item 4).
-- ============================================================================
-- "Several drafts have an empty or wrong pillar link."
--
-- tenant_settings.pillars is the live list — it overrides the code constants in
-- lib/km-content-system.ts — and every employment URL in it was wrong, checked
-- against the live site on 2026-09-24:
--
--   /wage-theft-overtime/      404
--   /workplace-discrimination/ 404
--   /leave-accommodations/     404
--   /severance/                200, but redirects to an unrelated WHISTLEBLOWER
--                              case result
--   /whistleblower/            200, redirects to that same case result
--   the rest                   200 only via a redirect to their real
--                              /practice-areas/ path
--
-- None of them existed in site_pages either, so lib/internal-links-check.ts
-- could never confirm a pillar link and drafts fell short of the three-confirmed
-- minimum no matter how many links they carried.
--
-- The stored list is also MISSING the employment hub. inferPillar falls back to
-- it for general terms ("employment lawyer nyc") and returns "" when it is
-- absent — which is the "empty pillar link" half of Diana's finding.
--
-- Keywords are preserved: the stored list carries custom keyword arrays that
-- are richer than the code hints, so this updates url/label in place rather
-- than replacing the rows.
--
-- Idempotent. Re-running changes nothing once applied.
-- ============================================================================

-- 1. Correct the URLs (and the labels that no longer match the page) ---------
update public.tenant_settings ts
   set pillars = (
     select jsonb_agg(
              case
                when fix.url is not null
                  then elem || jsonb_build_object('url', fix.url, 'label', fix.label)
                else elem
              end
              order by ord
            )
       from jsonb_array_elements(ts.pillars) with ordinality as t(elem, ord)
       left join (values
         ('wage-theft',           '/practice-areas/employment-law/wage-hour-claims-employees/',              'Wage and Hour Claims'),
         ('wrongful-termination', '/practice-areas/employment-law/wrongful-termination/',                    'Wrongful Termination'),
         ('discrimination',       '/practice-areas/employment-law/discrimination/',                          'Workplace Discrimination'),
         ('sexual-harassment',    '/practice-areas/employment-law/sexual-harassment/',                       'Sexual Harassment'),
         -- FMLA violations is the only leave practice-area page the site has.
         -- Narrower than "Leave and Accommodations" — if accommodations should
         -- be covered too, that is a new page, not a different URL.
         ('leave',                '/practice-areas/employment-law/fmla-violations/',                         'FMLA and Leave Violations'),
         ('hostile',              '/practice-areas/employment-law/sexual-harassment/hostile-work-environment/', 'Hostile Work Environment'),
         -- No dedicated severance page exists; employment agreements is the
         -- closest live parent. A placement decision worth confirming.
         ('severance',            '/practice-areas/employment-law/employment-agreements-contracts/',         'Employment Agreements and Contracts'),
         ('retaliation',          '/practice-areas/employment-law/retaliation/',                             'Retaliation'),
         ('whistleblower',        '/practice-areas/employment-law/whistleblower-protections/',               'Whistleblower Protections'),
         ('employment-hub',       '/practice-areas/employment-law/',                                         'Employment Law (Hub)'),
         ('collections-hub',      '/practice-areas/civil-litigation/collections-judgment-enforcement/',      'Collections Hub')
       ) as fix(id, url, label) on fix.id = elem->>'id'
   )
 where ts.pillars is not null
   and jsonb_typeof(ts.pillars) = 'array';

-- 2. Add the employment hub where it is missing ------------------------------
-- inferPillar routes un-pillared employment terms here rather than guessing a
-- specific pillar; without the row it returns "" and the draft ships with no
-- pillar link at all. No keywords by design — it is the catch-all, and is
-- deliberately skipped in pillar scoring so a specific pillar always wins.
update public.tenant_settings ts
   set pillars = ts.pillars || jsonb_build_array(
     jsonb_build_object(
       'id', 'employment-hub',
       'label', 'Employment Law (Hub)',
       'url', '/practice-areas/employment-law/',
       'practiceArea', 'employment',
       'keywords', jsonb_build_array()
     )
   )
 where ts.pillars is not null
   and jsonb_typeof(ts.pillars) = 'array'
   and not exists (
     select 1
       from jsonb_array_elements(ts.pillars) as elem
      where elem->>'id' = 'employment-hub'
   );

-- Check: every pillar and its URL, after the update.
--   select elem->>'id' as id, elem->>'url' as url
--     from public.tenant_settings,
--          lateral jsonb_array_elements(pillars) as elem
--    order by 1;
