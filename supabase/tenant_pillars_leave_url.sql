-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Point the `leave` pillar at the leave AND accommodations page.
-- ============================================================================
-- FOLLOW-UP to supabase/tenant_pillars_fix_urls.sql, which is already applied.
-- That file set every pillar URL correctly except this one, which it pointed at
-- /practice-areas/employment-law/fmla-violations/ — the only leave page under
-- /practice-areas/. Reviewing the keywords that actually route to this pillar
-- showed that was too narrow:
--
--   leave, fmla, ada accommodation, pregnancy leave, medical leave,
--   family leave, accommodation, accommodations, ada lawyer, breastfeeding
--
-- Five of the ten are accommodation/ADA terms, not leave. An ADA accommodation
-- blog would have sent its reader to an FMLA page.
--
-- /new-york-leave-and-accommodation-violations-lawyer/ covers both halves. It
-- returns 200 directly (no redirect), it is in site_pages so the pillar link
-- counts as confirmed, and its page title — "New York Leave and Accommodation
-- Violations Lawyer" — is the pillar's own name.
--
-- Confirmed by Kenneth, 2026-09-24.
--
-- Keywords are preserved: this updates url and label in place.
-- Idempotent. Re-running changes nothing once applied.
-- ============================================================================

update public.tenant_settings ts
   set pillars = (
     select jsonb_agg(
              case
                when elem->>'id' = 'leave'
                  then elem || jsonb_build_object(
                         'url', '/new-york-leave-and-accommodation-violations-lawyer/',
                         'label', 'Leave and Accommodation Violations'
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
       from jsonb_array_elements(ts.pillars) as elem
      where elem->>'id' = 'leave'
        and elem->>'url' is distinct from '/new-york-leave-and-accommodation-violations-lawyer/'
   );

-- Check: the leave pillar, after the update.
--   select elem->>'id' as id, elem->>'label' as label, elem->>'url' as url
--     from public.tenant_settings,
--          lateral jsonb_array_elements(pillars) as elem
--    where elem->>'id' = 'leave';
