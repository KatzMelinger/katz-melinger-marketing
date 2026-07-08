-- ============================================================================
-- !! DB TARGET CHECK — run against the LIVE marketing-SaaS Supabase project
-- (the one .env.local's NEXT_PUBLIC_SUPABASE_URL points at). Confirm the ref in
-- the dashboard URL before running.
-- ============================================================================

-- ============================================================================
-- social_insights.report_audience — curated demographics for the Monthly Report
-- ----------------------------------------------------------------------------
-- The Monthly Report's Sections 5-6 (Instagram + LinkedIn audience) come from
-- each platform's native analytics, which the Metricool API doesn't expose. We
-- store them here so the team can enter/maintain them in-app and the PDF matches
-- the hand-built report.
--
-- Deliberately a NEW column, separate from the existing `audience` column: the
-- Trends & Performance screen overwrites `audience` wholesale on save, so the
-- report's richer, per-platform demographics live apart to avoid either editor
-- clobbering the other's data.
--
-- JSON shape (all pct lists are [{ "label": "...", "pct": 34.5 }]):
--   {
--     "instagram": { "totalFollowers": 154,  "ageGroups":[], "gender":[],
--                    "topCities":[], "topCountries":[] },
--     "linkedin":  { "totalFollowers": 1878, "jobFunction":[], "seniority":[],
--                    "industry":[], "companySize":[], "location":[] }
--   }
--
-- Idempotent.
-- ============================================================================

alter table public.social_insights
  add column if not exists report_audience jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- OPTIONAL SEED — Katz Melinger's June 2026 audience figures, so Sections 5-6
-- aren't blank on first load. Editable afterward in the report UI. Idempotent:
-- only sets report_audience; leaves audience/topics/suggestion untouched.
-- Comment this block out if you'd rather enter the numbers by hand.
-- ----------------------------------------------------------------------------
insert into public.social_insights (tenant_id, report_audience)
values (
  '00000000-0000-0000-0000-000000000001',
  '{
    "instagram": {
      "totalFollowers": 154,
      "ageGroups": [
        {"label":"18-24","pct":0},
        {"label":"25-34","pct":2.8},
        {"label":"35-44","pct":34.5},
        {"label":"45-54","pct":48.7},
        {"label":"55-64","pct":7.7},
        {"label":"65+","pct":6.3}
      ],
      "gender": [
        {"label":"Women","pct":55.5},
        {"label":"Men","pct":44.5}
      ],
      "topCities": [
        {"label":"New York","pct":46},
        {"label":"Melville NY","pct":3},
        {"label":"Plainview NY","pct":2},
        {"label":"Miami Beach","pct":1}
      ],
      "topCountries": [
        {"label":"United States","pct":94},
        {"label":"India","pct":1},
        {"label":"Nicaragua","pct":1},
        {"label":"Puerto Rico","pct":1}
      ]
    },
    "linkedin": {
      "totalFollowers": 1878,
      "jobFunction": [
        {"label":"Legal","pct":25.6},
        {"label":"Business Development","pct":13.8},
        {"label":"Entrepreneurship","pct":7.6},
        {"label":"Operations","pct":4.6},
        {"label":"Sales","pct":4.4},
        {"label":"Finance","pct":4.3}
      ],
      "seniority": [
        {"label":"Senior","pct":30.4},
        {"label":"Entry","pct":22.6},
        {"label":"Director","pct":10},
        {"label":"Partner","pct":8.6},
        {"label":"VP","pct":6.2},
        {"label":"Owner","pct":5.1},
        {"label":"CXO","pct":4.5},
        {"label":"Manager","pct":3.7}
      ],
      "industry": [
        {"label":"Law Practice","pct":34.3},
        {"label":"Legal Services","pct":6.6},
        {"label":"Financial Services","pct":2.3},
        {"label":"Higher Education","pct":2.3},
        {"label":"Software Development","pct":2.2},
        {"label":"Consulting","pct":2.1}
      ],
      "companySize": [
        {"label":"11-50","pct":15.1},
        {"label":"1-10","pct":13.2},
        {"label":"51-200","pct":12.4},
        {"label":"1,001-5,000","pct":12.1},
        {"label":"10,001+","pct":11.3},
        {"label":"201-500","pct":6.5}
      ],
      "location": [
        {"label":"NYC metro","pct":67.5},
        {"label":"DC-Baltimore","pct":3},
        {"label":"Miami","pct":2},
        {"label":"Los Angeles","pct":2},
        {"label":"Boston","pct":2}
      ]
    }
  }'::jsonb
)
on conflict (tenant_id) do update
  set report_audience = excluded.report_audience;
