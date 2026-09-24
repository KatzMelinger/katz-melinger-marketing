-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- The employment-law constants (Diana 2.2, 21 Sep) — deadlines and coverage
-- thresholds, not just wage figures.
-- ============================================================================
-- "Why the layer missed the real errors live: the knowledge base does not have
-- these discrimination-law facts loaded."
--
-- Correct. Before this file the table held two wage thresholds and a list of
-- act names, so the value check had nothing to compare a deadline or a coverage
-- threshold against — and those are the two errors her five-draft test found
-- over and over: the NYSHRL administrative deadline stated as 1 year (it has
-- been 3 since 2024-02-15) and NYSHRL coverage stated as 4+ employees (it is
-- all employers).
--
-- Every value below is transcribed from section 2.2 of her document, which
-- lists them explicitly as "examples to load". Nothing here is inferred.
--
-- THREE CHANGES, in order:
--   1. widen the `unit` constraint — the table could only express money and
--      days, so "3 years" and "4 employees" had nowhere to live;
--   2. add `match_keywords`, because matching on jurisdiction + unit alone
--      cannot tell the NYSHRL administrative deadline from the NYCHRL statute
--      of limitations (both NY, both in years);
--   3. seed the constants.
-- ============================================================================

-- 1. Units -------------------------------------------------------------------
-- 'years' and 'employees' join the money units and 'days'. A coverage
-- threshold is stored as the MINIMUM number of employees for the law to apply,
-- so "all employers regardless of size" is 1 — the same shape as "15 or more",
-- which keeps one comparison working for both instead of a special case.
alter table public.legal_knowledge_base
  drop constraint if exists legal_knowledge_base_unit_check;
alter table public.legal_knowledge_base
  add constraint legal_knowledge_base_unit_check
  check (unit in ('usd_per_hour', 'usd_per_week', 'usd_per_year', 'days', 'years', 'employees', null));

-- 2. Disambiguation ----------------------------------------------------------
-- Each element is a set of alternatives separated by "|", and ALL elements
-- must be present in the sentence for the entry to apply. So
--   {'NYSHRL|New York State Human Rights Law', 'deadline|complaint|file|filing'}
-- matches "the NYSHRL complaint deadline" and "file with the New York State
-- Human Rights Law" but not a sentence that merely mentions the statute.
--
-- Empty array = fall back to jurisdiction + unit + region, which is all the
-- wage rows ever needed (there is only one NY minimum wage per region).
alter table public.legal_knowledge_base
  add column if not exists match_keywords text[] not null default '{}';

comment on column public.legal_knowledge_base.match_keywords is
  'Each element is a |-separated alternation; ALL elements must appear in a sentence for this entry to be compared against it. Empty = match on jurisdiction/unit/region alone.';

-- 3. Seed --------------------------------------------------------------------
insert into public.legal_knowledge_base
  (practice_area, jurisdiction, region, entry_type, key, label, unit,
   current_value, effective_date, prior_value, prior_effective_date,
   match_keywords, enforcement_path, source_url, notes, version, updated_by)
values
  -- --- New York: deadlines and coverage -------------------------------------
  -- Her "most common error in the library".
  ('employment', 'NY', null, 'threshold', 'nyshrl_admin_complaint_deadline',
   'NYSHRL administrative complaint deadline', 'years',
   3, '2024-02-15', 1, null,
   array['NYSHRL|New York State Human Rights Law|Human Rights Law',
         'deadline|complaint|file|filing|statute of limitations|time limit'],
   'NYSDHR administrative complaint, or civil action in Supreme Court',
   'https://dhr.ny.gov/complaint',
   'Diana 2.2, 2026-09-21: "NYSHRL administrative complaint deadline = 3 years (effective 2024-02-15; source NYSDHR). (Was 1 year - this is the most common error in the library.)"',
   1, 'diana-2026-09-21'),

  ('employment', 'NY', null, 'threshold', 'nyshrl_employer_coverage',
   'NYSHRL employer coverage (minimum employees)', 'employees',
   1, '2020-02-08', 4, null,
   array['NYSHRL|New York State Human Rights Law|Human Rights Law',
         'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null,
   'https://dhr.ny.gov/',
   'Diana 2.2, 2026-09-21: "NYSHRL coverage = all employers (any size, since 2019/2020)." Stored as 1 = any employer. The prior value of 4 is the figure drafts keep repeating; it is the NYC threshold, not the state one.',
   1, 'diana-2026-09-21'),

  ('employment', 'NY', null, 'threshold', 'nychrl_employer_coverage',
   'NYCHRL employer coverage for general discrimination (minimum employees)', 'employees',
   4, null, null, null,
   array['NYCHRL|New York City Human Rights Law|New York City law',
         'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null,
   'https://www.nyc.gov/site/cchr/index.page',
   'Diana 2.2, 2026-09-21: "NYCHRL coverage: general discrimination = 4+ employees; gender-based harassment = any size." The any-size carve-out for gender-based harassment is a qualifier a human must read, not a second number - see never_pair_with.',
   1, 'diana-2026-09-21'),

  ('employment', 'NY', null, 'threshold', 'nychrl_statute_of_limitations',
   'NYCHRL statute of limitations', 'years',
   3, null, null, null,
   array['NYCHRL|New York City Human Rights Law',
         'statute of limitations|deadline|file|filing|time limit|years to'],
   'New York State Supreme Court, or the NYC Commission on Human Rights',
   'https://www.nyc.gov/site/cchr/index.page',
   'Diana 2.2, 2026-09-21: "NYCHRL statute of limitations = 3 years."',
   1, 'diana-2026-09-21'),

  -- --- Federal: coverage and the charge deadline ----------------------------
  ('employment', 'federal', null, 'threshold', 'title_vii_employer_coverage',
   'Title VII employer coverage (minimum employees)', 'employees',
   15, null, null, null,
   array['Title VII', 'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null, 'https://www.eeoc.gov/employers/coverage',
   'Diana 2.2, 2026-09-21: "Title VII / ADA = 15+ employees."',
   1, 'diana-2026-09-21'),

  ('employment', 'federal', null, 'threshold', 'ada_employer_coverage',
   'ADA employer coverage (minimum employees)', 'employees',
   15, null, null, null,
   array['ADA|Americans with Disabilities Act',
         'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null, 'https://www.eeoc.gov/employers/coverage',
   'Diana 2.2, 2026-09-21: "Title VII / ADA = 15+ employees."',
   1, 'diana-2026-09-21'),

  ('employment', 'federal', null, 'threshold', 'adea_employer_coverage',
   'ADEA employer coverage (minimum employees)', 'employees',
   20, null, null, null,
   array['ADEA|Age Discrimination in Employment Act',
         'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null, 'https://www.eeoc.gov/employers/coverage',
   'Diana 2.2, 2026-09-21: "ADEA = 20+."',
   1, 'diana-2026-09-21'),

  ('employment', 'federal', null, 'threshold', 'eeoc_charge_deadline_deferral',
   'EEOC charge deadline in a deferral state (NY and NJ)', 'days',
   300, null, 180, null,
   array['EEOC', 'deadline|charge|file|filing|days to|time limit'],
   'EEOC charge, required before a Title VII/ADA/ADEA suit',
   'https://www.eeoc.gov/time-limits-filing-charge',
   'Diana 2.2, 2026-09-21: "EEOC charge = 300 days (deferral state like NY)." 180 days is the federal baseline and is stored as the prior value, because a draft explaining the relationship between the two is correct rather than wrong - see the seeded trap of the same name.',
   1, 'diana-2026-09-21'),

  -- --- New Jersey -----------------------------------------------------------
  ('employment', 'NJ', null, 'threshold', 'njlad_employer_coverage',
   'NJLAD employer coverage (minimum employees)', 'employees',
   1, null, null, null,
   array['NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination',
         'employee|employees|employer|employers|cover|covers|covered|applies|apply'],
   null, 'https://www.nj.gov/oag/dcr/',
   'Diana 2.2, 2026-09-21: "NJLAD coverage = all employers (1+)."',
   1, 'diana-2026-09-21'),

  ('employment', 'NJ', null, 'threshold', 'njlad_court_statute_of_limitations',
   'NJLAD statute of limitations in court', 'years',
   2, null, null, null,
   array['NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination',
         'statute of limitations|deadline|court|file|filing|time limit|years to'],
   'New Jersey Superior Court',
   'https://www.nj.gov/oag/dcr/',
   'Diana 2.2, 2026-09-21: "NJLAD ... court SOL = 2 years."',
   1, 'diana-2026-09-21'),

  ('employment', 'NJ', null, 'threshold', 'nj_dcr_admin_deadline',
   'NJ Division on Civil Rights administrative complaint deadline', 'days',
   180, null, null, null,
   array['DCR|Division on Civil Rights',
         'deadline|complaint|file|filing|days|time limit'],
   'NJ Division on Civil Rights',
   'https://www.nj.gov/oag/dcr/filing.html',
   'Diana 2.2, 2026-09-21: "NJ DCR administrative = 180 days."',
   1, 'diana-2026-09-21'),

  -- --- Wage and hour --------------------------------------------------------
  ('employment', 'NY', 'downstate', 'threshold', 'ny_overtime_exempt_threshold_downstate',
   'NY overtime-exempt salary threshold - NYC, Long Island, Westchester', 'usd_per_week',
   1275.00, '2026-01-01', null, null,
   array[]::text[], null, 'https://dol.ny.gov/minimum-wage',
   'Diana 2.2, 2026-09-21: "NY exempt salary $1,275/wk downstate ... (eff. 1/1/2026)."',
   1, 'diana-2026-09-21'),

  ('employment', 'NY', 'remainder_of_state', 'threshold', 'ny_overtime_exempt_threshold_remainder',
   'NY overtime-exempt salary threshold - remainder of state', 'usd_per_week',
   1199.10, '2026-01-01', null, null,
   array[]::text[], null, 'https://dol.ny.gov/minimum-wage',
   'Diana 2.2, 2026-09-21 confirms the effective date the original seed left null: "$1,199.10/wk rest of state (eff. 1/1/2026)."',
   1, 'diana-2026-09-21'),

  ('employment', 'NY', 'remainder_of_state', 'threshold', 'ny_min_wage_remainder',
   'NY minimum wage - remainder of state', 'usd_per_hour',
   16.00, '2026-01-01', null, null,
   array[]::text[], null, 'https://dol.ny.gov/minimum-wage',
   'Diana 2.2, 2026-09-21: "NY minimum wage $17 (NYC/LI/Westchester) / $16 (rest) eff. 1/1/2026."',
   1, 'diana-2026-09-21'),

  ('employment', 'federal', null, 'threshold', 'flsa_exempt_salary_threshold',
   'FLSA exempt salary threshold', 'usd_per_week',
   684.00, null, null, null,
   array[]::text[], null, 'https://www.dol.gov/agencies/whd/overtime',
   'Diana 2.2, 2026-09-21: "FLSA federal exempt salary $684/wk."',
   1, 'diana-2026-09-21'),

  ('employment', 'federal', null, 'threshold', 'federal_min_wage',
   'Federal minimum wage', 'usd_per_hour',
   7.25, null, null, null,
   array[]::text[], null, 'https://www.dol.gov/agencies/whd/minimum-wage',
   'Diana 2.2, 2026-09-21: "federal minimum wage $7.25."',
   1, 'diana-2026-09-21')

on conflict (tenant_id, entry_type, key) do update set
  practice_area = excluded.practice_area,
  jurisdiction = excluded.jurisdiction,
  region = excluded.region,
  label = excluded.label,
  unit = excluded.unit,
  -- Same single-level history the original seed uses: the figure that was
  -- current before an attorney changed it becomes the prior value, so a draft
  -- citing the old number with the old date still reads as once-correct.
  prior_value = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.current_value else excluded.prior_value end,
  prior_effective_date = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.effective_date else excluded.prior_effective_date end,
  current_value = excluded.current_value,
  effective_date = excluded.effective_date,
  match_keywords = excluded.match_keywords,
  enforcement_path = excluded.enforcement_path,
  source_url = excluded.source_url,
  notes = excluded.notes,
  version = public.legal_knowledge_base.version + 1,
  updated_by = excluded.updated_by,
  updated_at = now();

-- The NYCHRL gender-based-harassment carve-out is a qualifier, not a number:
-- recorded so a reviewer reading the coverage row sees it.
update public.legal_knowledge_base
   set never_pair_with = 'Gender-based harassment under the NYCHRL applies to employers of ANY size - the 4-employee threshold is for general discrimination only.'
 where entry_type = 'threshold' and key = 'nychrl_employer_coverage';
