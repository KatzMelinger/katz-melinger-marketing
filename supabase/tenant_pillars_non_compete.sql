-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Give non-compete its own pillar (Diana item 4, confirmed by Kenneth).
-- ============================================================================
-- "Several drafts have an empty or wrong pillar link (the non-compete blog is
-- mapped to /severance/)."
--
-- She was right, and the page she implicitly wanted already exists:
-- /practice-areas/employment-law/what-is-a-non-compete-agreement/ ("Non-Compete
-- Agreements: Enforceability After Termination"), live, 200, in site_pages.
-- The only thing missing was a pillar pointing at it, so non-compete keywords
-- fell through to severance and every non-compete blog linked up to the
-- agreements page instead — and before tenant_pillars_fix_urls.sql, to an
-- unrelated whistleblower case result.
--
-- Two changes, and the second matters as much as the first: adding the pillar
-- without taking the non-compete spellings OFF severance would leave both
-- scoring on the same draft, and which one won would depend on how the copy
-- happened to be worded.
--
-- "restrictive covenant" moves too. It is the umbrella term, but the
-- non-compete page is the firm's flagship page for it; severance keeps the
-- terms that belong to the agreements page (employment agreement/contract,
-- NDA, non-solicit) alongside severance itself.
--
-- Idempotent. Re-running changes nothing once applied.
-- ============================================================================

-- 1. Take the non-compete spellings off the severance pillar -----------------
update public.tenant_settings ts
   set pillars = (
     select jsonb_agg(
              case
                when elem->>'id' = 'severance'
                  then jsonb_set(
                         elem,
                         '{keywords}',
                         coalesce(
                           (
                             select jsonb_agg(k)
                               from jsonb_array_elements_text(
                                      coalesce(elem->'keywords', '[]'::jsonb)
                                    ) as k
                              where lower(k) not in (
                                'non-compete', 'noncompete', 'non compete',
                                'restrictive covenant', 'non-competition', 'no-compete'
                              )
                           ),
                           '[]'::jsonb
                         )
                       )
                else elem
              end
              order by ord
            )
       from jsonb_array_elements(ts.pillars) with ordinality as t(elem, ord)
   )
 where ts.pillars is not null
   and jsonb_typeof(ts.pillars) = 'array'
   and exists (
     select 1
       from jsonb_array_elements(ts.pillars) as elem,
            lateral jsonb_array_elements_text(coalesce(elem->'keywords', '[]'::jsonb)) as k
      where elem->>'id' = 'severance'
        and lower(k) in ('non-compete', 'noncompete', 'non compete',
                         'restrictive covenant', 'non-competition', 'no-compete')
   );

-- 2. Add the pillar ----------------------------------------------------------
update public.tenant_settings ts
   set pillars = ts.pillars || jsonb_build_array(
     jsonb_build_object(
       'id', 'non-compete',
       'label', 'Non-Compete Agreements',
       'url', '/practice-areas/employment-law/what-is-a-non-compete-agreement/',
       'practiceArea', 'employment',
       'keywords', jsonb_build_array(
         'non-compete', 'noncompete', 'non compete',
         'restrictive covenant', 'non-competition', 'no-compete'
       )
     )
   )
 where ts.pillars is not null
   and jsonb_typeof(ts.pillars) = 'array'
   and not exists (
     select 1
       from jsonb_array_elements(ts.pillars) as elem
      where elem->>'id' = 'non-compete'
   );

-- Check: the two pillars and their keywords, after the update.
--   select elem->>'id' as id, elem->>'url' as url, elem->'keywords' as keywords
--     from public.tenant_settings,
--          lateral jsonb_array_elements(pillars) as elem
--    where elem->>'id' in ('severance', 'non-compete');
