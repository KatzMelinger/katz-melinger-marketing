-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ############################################################################
-- ##                                                                        ##
-- ##  ATTORNEY SIGN-OFF REQUIRED BEFORE RUNNING: Diana's spec says an       ##
-- ##  attorney must initial Appendices A and B before loading.              ##
-- ##                                                                        ##
-- ##  Reviewed by: ______________________   Date: ______________            ##
-- ##                                                                        ##
-- ############################################################################

-- ============================================================================
-- Diana's Sept 28 spec, Appendix B — the legal constants, loaded into
-- public.legal_knowledge_base (the table lib/legal-value-check.ts reads).
-- NOT legal_kb_entries (lib/legal-kb.ts) — that is a different table.
-- ----------------------------------------------------------------------------
-- Requires legal_knowledge_base_schema.sql and legal_knowledge_base_constants.sql
-- (the 'years'/'employees' units and the match_keywords column) — both live.
--
-- Live state checked read-only on 2026-09-29: 17 threshold rows. This file
--   UPDATES 16 of them (same key, values confirmed/refreshed, keywords tightened)
--   INSERTS 16 new rows
--   leaves 1 alone: flsa_exempt_salary_threshold ($684/wk, not in Appendix B).
-- Idempotent: on conflict (tenant_id, entry_type, key) do update.
--
-- Fixture test mirroring every row below (keep in sync if you edit keywords):
--   node scripts/run.mjs scripts/check-legal-constants-sept28.ts
--
-- ----------------------------------------------------------------------------
-- HOW match_keywords SELECTS A ROW (lib/legal-value-check.ts)
-- ----------------------------------------------------------------------------
-- Deadlines (days/years) and coverage (employees) have no jurisdiction filter:
-- a sentence is compared against the row whose keyword groups ALL appear in it
-- (case-insensitive substring), and when several rows qualify the one with the
-- MOST groups wins. There is no "unless" / negation. So:
--   * Carve-outs (NYCHRL gender-based harassment, FLSA/FMLA willful) are their
--     own row with one EXTRA group, so they out-rank the general row whenever
--     the carve-out words are in the sentence.
--   * A few rows carry a group that is always present for their unit ('year'
--     for a years row, 'day|month' for a days row). It never excludes anything
--     for that unit; it exists only to out-rank a broader sibling row, e.g.
--     § 215 (2 years) over the general NY Labor Law row (6 years).
--   * The bare phrase "Human Rights Law" is gone from the NYSHRL rows: it is a
--     substring of "New York City Human Rights Law" and made NYCHRL sentences
--     tie with NYSHRL ones. Bare "ADA" is gone too ("Canada", "Nevada").
--
-- KNOWN LIMITATION — one sentence stating two correct sibling values.
--   The row is chosen per SENTENCE, not per number, so a correct sentence that
--   states both values flags one of them, e.g.
--     "two years, or three years for willful violations" (FLSA / FMLA)
--     "four or more employees ... all employers for gender-based harassment"
--     "EEOC within 300 days or the Division on Civil Rights within 180 days"
--     "FLSA two years ... New York Labor Law six years"
--   Fixing that needs a code change (pick the row whose keywords sit nearest
--   the number, or split on clauses), not data. The test script prints these.
--
-- ----------------------------------------------------------------------------
-- NOT LOADED — Appendix B items this schema cannot express
-- ----------------------------------------------------------------------------
--   * NY wage notice penalty, $50 per workday up to $5,000 (Lab. Law 198(1-b))
--     and wage statement penalty, $250 per workday up to $5,000 (198(1-d)):
--     a per-day rate WITH a cap is two numbers, and the money check only reads
--     "$X per hour/week/year" — "$250 per violation" / "per day" is never
--     extracted. The new Sept 28 traps cover the "$250 per violation" error.
--   * Damages caps (e.g. liquidated damages, statutory caps): no cap/percent
--     unit exists; a cap is a ceiling, not a current value to equal.
--   * CPLR 5004 prejudgment interest, 9% (general rate; 2% for consumer debt):
--     no percent unit, and two rates keyed on the kind of debt.
--   * Anything "3 years if willful" is loaded as its own willful row (above),
--     not as a qualifier on the 2-year row.
--
-- ----------------------------------------------------------------------------
-- CALENDAR — rows that go stale on a known date
-- ----------------------------------------------------------------------------
--   * ny_min_wage_downstate / ny_min_wage_remainder: 2027 NY minimum wage is
--     CPI-indexed; DOL must publish it by 2026-10-01. UPDATE BOTH ROWS IN
--     JANUARY 2027 (and the exempt-salary rows, which are set off the same
--     rate). Keep lib/current-facts in step.
--   * nj_min_wage: NJ adjusts every January 1 by CPI. Update January 2027.
-- ============================================================================

insert into public.legal_knowledge_base
  (practice_area, jurisdiction, region, entry_type, key, label, unit,
   current_value, effective_date, prior_value, prior_effective_date,
   match_keywords, enforcement_path, never_pair_with, source_url, notes, version, updated_by)
values
  -- ==========================================================================
  -- MONEY. match_keywords stay empty: the money check selects by
  -- jurisdiction + unit + region, not keywords.
  -- ==========================================================================
  -- UPDATE (values already correct live; source/notes refreshed)
  ('employment', 'NY', 'downstate', 'threshold', 'ny_min_wage_downstate',
   'NY minimum wage - NYC, Long Island, Westchester', 'usd_per_hour',
   17.00, '2026-01-01', 16.50, '2025-01-01',
   array[]::text[], 'NYS DOL wage claim, or civil action under Labor Law art. 19',
   null,
   'https://www.nysenate.gov/legislation/laws/LAB/652',
   'Diana Appendix B, 2026-09-28: "NY minimum wage NYC/Long Island/Westchester: $17.00/hr eff. 2026-01-01 (prior $16.50). NY Labor Law § 652." 2027 rate is CPI-indexed and must be published by DOL by 2026-10-01 - UPDATE THIS ROW IN JANUARY 2027.',
   1, 'diana-2026-09-28'),

  -- UPDATE (adds the prior figure)
  ('employment', 'NY', 'remainder_of_state', 'threshold', 'ny_min_wage_remainder',
   'NY minimum wage - remainder of state', 'usd_per_hour',
   16.00, '2026-01-01', 15.50, '2025-01-01',
   array[]::text[], 'NYS DOL wage claim, or civil action under Labor Law art. 19',
   null,
   'https://www.nysenate.gov/legislation/laws/LAB/652',
   'Diana Appendix B, 2026-09-28: "NY minimum wage rest of state: $16.00/hr eff. 2026-01-01 (prior $15.50). NY Labor Law § 652." 2027 rate is CPI-indexed and must be published by DOL by 2026-10-01 - UPDATE THIS ROW IN JANUARY 2027.',
   1, 'diana-2026-09-28'),

  -- UPDATE (adds the effective date)
  ('employment', 'federal', null, 'threshold', 'federal_min_wage',
   'Federal minimum wage', 'usd_per_hour',
   7.25, '2009-07-24', null, null,
   array[]::text[], 'U.S. DOL Wage and Hour Division, or FLSA civil action',
   null,
   'https://www.law.cornell.edu/uscode/text/29/206',
   'Diana Appendix B, 2026-09-28: "Federal minimum wage $7.25 eff. 2009-07-24, 29 U.S.C. § 206."',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'NY', 'downstate', 'threshold', 'ny_overtime_exempt_threshold_downstate',
   'NY exempt salary threshold (executive/administrative) - NYC, Long Island, Westchester', 'usd_per_week',
   1275.00, '2026-01-01', null, null,
   array[]::text[], null,
   null,
   'https://www.law.cornell.edu/regulations/new-york/12-NYCRR-142-2.14',
   'Diana Appendix B, 2026-09-28: "NY exempt salary threshold exec/admin: NYC/LI/Westchester $1,275.00/week eff. 2026-01-01. 12 NYCRR 142-2.14." Moves with the 2027 CPI-indexed minimum wage - review in January 2027.',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'NY', 'remainder_of_state', 'threshold', 'ny_overtime_exempt_threshold_remainder',
   'NY exempt salary threshold (executive/administrative) - remainder of state', 'usd_per_week',
   1199.10, '2026-01-01', null, null,
   array[]::text[], null,
   'Never pair $1,275.00 with the rest of the state - that is the downstate figure.',
   'https://www.law.cornell.edu/regulations/new-york/12-NYCRR-142-2.14',
   'Diana Appendix B, 2026-09-28: "NY exempt salary threshold exec/admin: rest of state $1,199.10/week eff. 2026-01-01. 12 NYCRR 142-2.14." Moves with the 2027 CPI-indexed minimum wage - review in January 2027.',
   1, 'diana-2026-09-28'),

  -- INSERT. Not in Diana's table: added so NJ hourly figures have something
  -- to compare against. NOTE: with this row present, ANY other $/hour figure in
  -- a sentence the checker reads as New Jersey (the $15.23 seasonal/small rate,
  -- the $6.05 tipped cash wage, a long-term-care direct-care rate) is flagged
  -- as a mismatch against $15.92. A reviewer dismisses those; if that is too
  -- noisy, add them as their own NJ rows with a distinct region.
  ('employment', 'NJ', null, 'threshold', 'nj_min_wage',
   'NJ minimum wage - most employers', 'usd_per_hour',
   15.92, '2026-01-01', null, null,
   array[]::text[], 'NJ DOL Wage and Hour Compliance, or civil action (N.J.S.A. 34:11-56a25)',
   null,
   'https://business.nj.gov/updates/minimum-wage-now-15-92-per-hour-for-most-workers',
   'Added 2026-09-28 (not in Diana''s Appendix B) so NJ figures stop false-alarming: $15.92/hr for most employers eff. 2026-01-01. Seasonal and small employers (fewer than 6 employees): $15.23/hr. Tipped workers: $6.05/hr cash wage. Adjusted each January 1 by CPI - update in January 2027.',
   1, 'diana-2026-09-28'),

  -- ==========================================================================
  -- NEW YORK STATE HUMAN RIGHTS LAW
  -- ==========================================================================
  -- UPDATE: keywords now also catch "Division of Human Rights"/DHR (Diana's
  -- test sentence names the agency, not the statute), and drop the bare
  -- "Human Rights Law" that collided with NYCHRL.
  ('employment', 'NY', null, 'threshold', 'nyshrl_admin_complaint_deadline',
   'NYSHRL Division of Human Rights complaint deadline', 'years',
   3, '2024-02-15', 1, null,
   array['NYSHRL|State Human Rights Law|New York Human Rights Law|Division of Human Rights|NYSDHR|DHR',
         'deadline|complaint|file|filing|statute of limitations|time limit|within'],
   'NYS Division of Human Rights complaint',
   null,
   'https://www.nysenate.gov/legislation/laws/EXC/297',
   'Diana Appendix B, 2026-09-28: "NYSHRL DHR complaint deadline: 3 years (conduct on/after 2024-02-15), Exec. Law § 297(5)." Was 1 year for earlier conduct - the most common error in the library.',
   1, 'diana-2026-09-28'),

  -- INSERT. Three groups so it out-ranks the DHR row on court sentences; both
  -- are 3 years, so a tie would be harmless anyway.
  ('employment', 'NY', null, 'threshold', 'nyshrl_lawsuit_deadline',
   'NYSHRL lawsuit deadline (court)', 'years',
   3, null, null, null,
   array['NYSHRL|State Human Rights Law|New York Human Rights Law',
         'lawsuit|to sue|court|civil action|CPLR',
         'file|filing|deadline|statute of limitations|limitations period|within|time limit|bring'],
   'Civil action in NY Supreme Court (election of remedies: not if a DHR complaint was filed)',
   null,
   'https://www.nysenate.gov/legislation/laws/CVP/214',
   'Diana Appendix B, 2026-09-28: "NYSHRL lawsuit deadline: 3 years, CPLR 214(2)."',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'NY', null, 'threshold', 'nyshrl_employer_coverage',
   'NYSHRL employer coverage', 'employees',
   1, '2020-02-08', 4, null,
   array['NYSHRL|State Human Rights Law|New York Human Rights Law',
         'employee|employer|cover|applies|apply'],
   null,
   null,
   'https://www.nysenate.gov/legislation/laws/EXC/292',
   'Diana Appendix B, 2026-09-28: "NYSHRL employer coverage: all employers since 2020-02-08, Exec. Law § 292(5)." Stored as 1 = any size. 4 is the NYC figure drafts keep borrowing.',
   1, 'diana-2026-09-28'),

  -- ==========================================================================
  -- NEW YORK CITY HUMAN RIGHTS LAW / COMMISSION ON HUMAN RIGHTS
  -- ==========================================================================
  -- UPDATE (general discrimination, 4+). The gender-based harassment carve-out
  -- is the next row, which out-ranks this one when harassment words appear.
  -- LIMITATION: a sentence about gender-based harassment that does not use one
  -- of the carve-out phrases ("gender-based harassment", "gender harassment",
  -- "sexual harassment") is compared against 4+.
  ('employment', 'NY', null, 'threshold', 'nychrl_employer_coverage',
   'NYCHRL employer coverage (general discrimination)', 'employees',
   4, null, null, null,
   array['NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law',
         'employee|employer|cover|applies|apply'],
   null,
   'Gender-based harassment under the NYCHRL applies to employers of ANY size - the 4-employee threshold is for general discrimination only.',
   'https://www.nyc.gov/site/cchr/law/the-law.page',
   'Diana Appendix B, 2026-09-28: "NYCHRL employer coverage: 4 or more employees (general discrimination); all employers for gender-based harassment. Admin. Code § 8-102." See row nychrl_gbh_employer_coverage for the carve-out.',
   1, 'diana-2026-09-28'),

  -- INSERT
  ('employment', 'NY', null, 'threshold', 'nychrl_gbh_employer_coverage',
   'NYCHRL employer coverage for gender-based harassment', 'employees',
   1, null, null, null,
   array['NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law',
         'employee|employer|cover|applies|apply',
         'gender-based harassment|gender based harassment|gender harassment|sexual harassment'],
   null,
   'Do not apply the 4-employee general-discrimination threshold to gender-based harassment.',
   'https://www.nyc.gov/site/cchr/law/the-law.page',
   'Diana Appendix B, 2026-09-28: "NYCHRL employer coverage: ... all employers for gender-based harassment. Admin. Code § 8-102." Stored as 1 = any size. Sexual harassment is gender-based harassment under the NYCHRL.',
   1, 'diana-2026-09-28'),

  -- UPDATE. Loses "New York City law" (too loose for a deadline) and gains
  -- lawsuit/court words. The Commission rows below out-rank it on Commission
  -- sentences.
  ('employment', 'NY', null, 'threshold', 'nychrl_statute_of_limitations',
   'NYCHRL lawsuit deadline (court)', 'years',
   3, null, null, null,
   array['NYCHRL|New York City Human Rights Law|NYC Human Rights Law',
         'statute of limitations|limitations period|deadline|file|filing|time limit|years to|lawsuit|to sue|court'],
   'Civil action in NY Supreme Court',
   null,
   'https://www.nyc.gov/site/cchr/law/the-law.page',
   'Diana Appendix B, 2026-09-28: "NYCHRL lawsuit deadline: 3 years, Admin. Code § 8-502(d)."',
   1, 'diana-2026-09-28'),

  -- INSERT. 'year' is a specificity group (always present for a years
  -- mention) so this out-ranks the NYCHRL court row on Commission sentences.
  ('employment', 'NY', null, 'threshold', 'nyc_cchr_complaint_deadline',
   'NYC Commission on Human Rights complaint deadline', 'years',
   1, null, null, null,
   array['Commission on Human Rights|CCHR',
         'file|filing|complaint|deadline|within|time limit|statute of limitations',
         'year'],
   'NYC Commission on Human Rights complaint',
   'Gender-based harassment complaints have 3 years, not 1.',
   'https://www.nyc.gov/site/cchr/law/the-law.page',
   'Diana Appendix B, 2026-09-28: "NYC Commission on Human Rights complaint deadline: 1 year (3 years for gender-based harassment), Admin. Code § 8-109(e)." LIMITATION: a gender-based harassment sentence that does not use a carve-out phrase is compared against 1 year.',
   1, 'diana-2026-09-28'),

  -- INSERT
  ('employment', 'NY', null, 'threshold', 'nyc_cchr_gbh_complaint_deadline',
   'NYC Commission on Human Rights complaint deadline - gender-based harassment', 'years',
   3, null, null, null,
   array['Commission on Human Rights|CCHR',
         'file|filing|complaint|deadline|within|time limit|statute of limitations',
         'year',
         'gender-based harassment|gender based harassment|gender harassment|sexual harassment'],
   'NYC Commission on Human Rights complaint',
   null,
   'https://www.nyc.gov/site/cchr/law/the-law.page',
   'Diana Appendix B, 2026-09-28: "NYC Commission on Human Rights complaint deadline: ... 3 years for gender-based harassment, Admin. Code § 8-109(e)."',
   1, 'diana-2026-09-28'),

  -- ==========================================================================
  -- EEOC AND FEDERAL COVERAGE
  -- ==========================================================================
  -- UPDATE. Prior 180 kept as live had it (the federal non-deferral baseline).
  ('employment', 'federal', null, 'threshold', 'eeoc_charge_deadline_deferral',
   'EEOC charge deadline in NY and NJ', 'days',
   300, null, 180, null,
   array['EEOC|Equal Employment Opportunity Commission',
         'deadline|charge|file|filing|days to|time limit'],
   'EEOC charge, required before a Title VII/ADA/ADEA suit',
   null,
   'https://www.law.cornell.edu/uscode/text/42/2000e-5',
   'Diana Appendix B, 2026-09-28: "EEOC charge deadline in NY and NJ: 300 days, 42 U.S.C. § 2000e-5(e)(1)." NY and NJ are deferral states; 180 days is the non-deferral baseline.',
   1, 'diana-2026-09-28'),

  -- INSERT. The lawsuit group deliberately omits bare "sue" ("right-to-sue"
  -- contains it), so "request a right-to-sue letter after 180 days" is not
  -- read as the 90-day deadline. 'day|month' is a specificity group.
  ('employment', 'federal', null, 'threshold', 'eeoc_right_to_sue_deadline',
   'Deadline to sue after an EEOC right-to-sue notice', 'days',
   90, null, null, null,
   array['right to sue|right-to-sue|notice of right',
         'lawsuit|court|file suit|filing suit|bring suit|civil action|file a complaint in',
         'day|month'],
   'Federal court civil action',
   null,
   'https://www.law.cornell.edu/uscode/text/42/2000e-5',
   'Diana Appendix B, 2026-09-28: "Deadline to sue after right-to-sue: 90 days," 42 U.S.C. § 2000e-5(f)(1).',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'federal', null, 'threshold', 'title_vii_employer_coverage',
   'Title VII employer coverage', 'employees',
   15, null, null, null,
   array['Title VII', 'employee|employer|cover|applies|apply'],
   null, null,
   'https://www.law.cornell.edu/uscode/text/42/2000e',
   'Diana Appendix B, 2026-09-28: "Title VII and ADA coverage: 15 or more employees," 42 U.S.C. § 2000e(b).',
   1, 'diana-2026-09-28'),

  -- UPDATE. Bare "ADA" removed ("Canada", "Nevada", "adapt").
  ('employment', 'federal', null, 'threshold', 'ada_employer_coverage',
   'ADA employer coverage', 'employees',
   15, null, null, null,
   array['Americans with Disabilities Act|the ADA|(ADA)|ADA''s|ADA covers|ADA applies',
         'employee|employer|cover|applies|apply'],
   null, null,
   'https://www.law.cornell.edu/uscode/text/42/12111',
   'Diana Appendix B, 2026-09-28: "Title VII and ADA coverage: 15 or more employees," 42 U.S.C. § 12111(5)(A).',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'federal', null, 'threshold', 'adea_employer_coverage',
   'ADEA employer coverage', 'employees',
   20, null, null, null,
   array['ADEA|Age Discrimination in Employment Act', 'employee|employer|cover|applies|apply'],
   null, null,
   'https://www.law.cornell.edu/uscode/text/29/630',
   'Diana Appendix B, 2026-09-28: "ADEA: 20 or more employees," 29 U.S.C. § 630(b).',
   1, 'diana-2026-09-28'),

  -- ==========================================================================
  -- NEW JERSEY LAW AGAINST DISCRIMINATION
  -- ==========================================================================
  -- UPDATE
  ('employment', 'NJ', null, 'threshold', 'nj_dcr_admin_deadline',
   'NJ Division on Civil Rights complaint deadline', 'days',
   180, null, null, null,
   array['DCR|Division on Civil Rights', 'deadline|complaint|file|filing|days|time limit'],
   'NJ Division on Civil Rights verified complaint',
   null,
   'https://www.nj.gov/oag/dcr/filing.html',
   'Diana Appendix B, 2026-09-28: "NJLAD DCR deadline: 180 days (N.J.S.A. 10:5-18)."',
   1, 'diana-2026-09-28'),

  -- UPDATE. Second group narrowed to court words: with "file|filing|deadline"
  -- the row matched "file with the DCR within one year" and its fix would
  -- have said "2 years" for what is a 180-day agency deadline.
  ('employment', 'NJ', null, 'threshold', 'njlad_court_statute_of_limitations',
   'NJLAD lawsuit deadline (court)', 'years',
   2, null, null, null,
   array['NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination',
         'statute of limitations|limitations period|court|lawsuit|to sue|civil action|time limit|years to'],
   'New Jersey Superior Court',
   null,
   'https://www.nj.gov/oag/dcr/',
   'Diana Appendix B, 2026-09-28: "NJLAD lawsuit deadline: 2 years (Montells v. Haynes, 133 N.J. 282 (1993))."',
   1, 'diana-2026-09-28'),

  -- UPDATE
  ('employment', 'NJ', null, 'threshold', 'njlad_employer_coverage',
   'NJLAD employer coverage', 'employees',
   1, null, null, null,
   array['NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination',
         'employee|employer|cover|applies|apply'],
   null, null,
   'https://www.nj.gov/oag/dcr/',
   'Diana Appendix B, 2026-09-28: "NJLAD coverage: all employers (N.J.S.A. 10:5-5(e))." Stored as 1 = any size.',
   1, 'diana-2026-09-28'),

  -- ==========================================================================
  -- WAGE AND HOUR, LEAVE, RETALIATION — limitations periods (all INSERT)
  -- ==========================================================================
  ('employment', 'federal', null, 'threshold', 'flsa_statute_of_limitations',
   'FLSA limitations period (non-willful)', 'years',
   2, null, null, null,
   array['FLSA|Fair Labor Standards Act',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline|recover|back pay|back wages|look back|lookback'],
   'U.S. DOL Wage and Hour Division, or FLSA civil action',
   'Willful violations: 3 years (row flsa_willful_statute_of_limitations).',
   'https://www.law.cornell.edu/uscode/text/29/255',
   'Diana Appendix B, 2026-09-28: "FLSA limitations: 2 years (3 if willful), 29 U.S.C. § 255(a)." Stored as 2; the willful 3 is its own row that wins when "willful" is in the sentence.',
   1, 'diana-2026-09-28'),

  ('employment', 'federal', null, 'threshold', 'flsa_willful_statute_of_limitations',
   'FLSA limitations period (willful violation)', 'years',
   3, null, null, null,
   array['FLSA|Fair Labor Standards Act',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline|recover|back pay|back wages|look back|lookback',
         'willful'],
   'U.S. DOL Wage and Hour Division, or FLSA civil action',
   null,
   'https://www.law.cornell.edu/uscode/text/29/255',
   'Diana Appendix B, 2026-09-28: "FLSA limitations: 2 years (3 if willful), 29 U.S.C. § 255(a)." This is the willful half.',
   1, 'diana-2026-09-28'),

  ('employment', 'NY', null, 'threshold', 'nyll_statute_of_limitations',
   'NY Labor Law wage claim limitations period', 'years',
   6, null, null, null,
   array['NYLL|New York Labor Law|NY Labor Law|New York State Labor Law',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline|recover|back pay|back wages|look back|lookback'],
   'NYS DOL wage claim, or civil action',
   null,
   'https://www.nysenate.gov/legislation/laws/LAB/198',
   'Diana Appendix B, 2026-09-28: "NY Labor Law limitations: 6 years (§ 198(3), § 663(3))." §§ 215 and 740 (2 years) are their own rows and out-rank this one.',
   1, 'diana-2026-09-28'),

  ('employment', 'NY', null, 'threshold', 'nyll_215_retaliation_limitations',
   'NY Labor Law § 215 retaliation limitations period', 'years',
   2, null, null, null,
   array['§ 215|§215|section 215|Labor Law 215',
         'retaliat|limitations|lawsuit|to sue|file|filing|deadline|time limit|years to|claim',
         'year'],
   'Civil action, or NYS DOL complaint',
   null,
   'https://www.nysenate.gov/legislation/laws/LAB/215',
   'Diana Appendix B, 2026-09-28: "§ 215 retaliation: 2-year limitations period."',
   1, 'diana-2026-09-28'),

  -- New York context required so NJ CEPA (1 year) whistleblower copy is not
  -- compared against this.
  ('employment', 'NY', null, 'threshold', 'nyll_740_whistleblower_limitations',
   'NY Labor Law § 740 whistleblower limitations period', 'years',
   2, null, null, null,
   array['§ 740|§740|section 740|Labor Law 740|New York whistleblower|NY whistleblower|New York''s whistleblower',
         'retaliat|whistleblow|limitations|lawsuit|to sue|file|filing|deadline|time limit|years to|claim',
         'year'],
   'Civil action',
   null,
   'https://www.nysenate.gov/legislation/laws/LAB/740',
   'Diana Appendix B, 2026-09-28: "§ 740 whistleblower: 2-year limitations period."',
   1, 'diana-2026-09-28'),

  -- Requires a safety word: OSHA also takes complaints under ~20 other
  -- whistleblower statutes with different deadlines (e.g. SOX, 180 days).
  ('employment', 'federal', null, 'threshold', 'osha_11c_complaint_deadline',
   'OSHA Section 11(c) retaliation complaint deadline', 'days',
   30, null, null, null,
   array['OSHA|Occupational Safety|OSH Act|11(c)',
         'safety|unsafe|hazard|11(c)',
         'retaliat|complaint|file|filing|deadline|within|report'],
   'OSHA whistleblower complaint',
   null,
   'https://www.law.cornell.edu/uscode/text/29/660',
   'Diana Appendix B, 2026-09-28: "OSHA 11(c) complaint: 30 days," 29 U.S.C. § 660(c)(2). Other OSHA-administered whistleblower statutes have their own deadlines and are not this row.',
   1, 'diana-2026-09-28'),

  -- No "file|filing" in the second group: "to be eligible ... worked at least
  -- one year" is FMLA eligibility, not the limitations period.
  ('employment', 'federal', null, 'threshold', 'fmla_statute_of_limitations',
   'FMLA limitations period (non-willful)', 'years',
   2, null, null, null,
   array['FMLA|Family and Medical Leave Act',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline'],
   'U.S. DOL Wage and Hour Division, or civil action',
   'Willful violations: 3 years (row fmla_willful_statute_of_limitations).',
   'https://www.law.cornell.edu/uscode/text/29/2617',
   'Diana Appendix B, 2026-09-28: "FMLA limitations: 2 years (3 if willful), 29 U.S.C. § 2617(c)." Stored as 2; the willful 3 is its own row.',
   1, 'diana-2026-09-28'),

  ('employment', 'federal', null, 'threshold', 'fmla_willful_statute_of_limitations',
   'FMLA limitations period (willful violation)', 'years',
   3, null, null, null,
   array['FMLA|Family and Medical Leave Act',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline',
         'willful'],
   'U.S. DOL Wage and Hour Division, or civil action',
   null,
   'https://www.law.cornell.edu/uscode/text/29/2617',
   'Diana Appendix B, 2026-09-28: "FMLA limitations: 2 years (3 if willful), 29 U.S.C. § 2617(c)." This is the willful half.',
   1, 'diana-2026-09-28'),

  ('employment', 'NY', null, 'threshold', 'nyc_esst_dcwp_complaint_deadline',
   'NYC safe and sick time DCWP complaint deadline', 'years',
   2, null, null, null,
   array['DCWP|Consumer and Worker Protection',
         'sick|ESSTA|ESTA',
         'complaint|file|filing|deadline|within|time limit'],
   'NYC Department of Consumer and Worker Protection complaint',
   null,
   'https://www.nyc.gov/site/dca/workers/workersrights/paid-safe-and-sick-leave-workers.page',
   'Diana Appendix B, 2026-09-28: "NYC safe and sick time DCWP complaint deadline: 2 years" (NYC Earned Safe and Sick Time Act, Admin. Code Title 20, ch. 8). Source URL is the DCWP landing page - attorney to confirm the section cite.',
   1, 'diana-2026-09-28'),

  ('employment', 'NJ', null, 'threshold', 'nj_whl_statute_of_limitations',
   'NJ Wage and Hour Law limitations period', 'years',
   6, '2019-08-06', 2, null,
   array['New Jersey Wage and Hour Law|NJ Wage and Hour Law|NJWHL|Wage Theft Act',
         'statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline|recover|back pay|back wages|look back|lookback'],
   'NJ DOL Wage and Hour Compliance, or civil action',
   null,
   'https://www.nj.gov/labor/wageandhour/',
   'Diana Appendix B, 2026-09-28: "NJ Wage and Hour Law limitations: 6 years (Wage Theft Act, eff. 2019-08-06), N.J.S.A. 34:11-56a25.1." Prior value 2 years is the pre-Wage Theft Act period.',
   1, 'diana-2026-09-28')

on conflict (tenant_id, entry_type, key) do update set
  practice_area = excluded.practice_area,
  jurisdiction = excluded.jurisdiction,
  region = excluded.region,
  label = excluded.label,
  unit = excluded.unit,
  -- Same single-level history as legal_knowledge_base_constants.sql: if the
  -- figure changed, the old current becomes the prior; otherwise take the
  -- prior this file states (which matches live wherever live had one).
  prior_value = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.current_value else excluded.prior_value end,
  prior_effective_date = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.effective_date else excluded.prior_effective_date end,
  current_value = excluded.current_value,
  effective_date = excluded.effective_date,
  match_keywords = excluded.match_keywords,
  enforcement_path = excluded.enforcement_path,
  -- Keep a live never_pair_with this file doesn't restate.
  never_pair_with = coalesce(excluded.never_pair_with, public.legal_knowledge_base.never_pair_with),
  source_url = excluded.source_url,
  notes = excluded.notes,
  version = public.legal_knowledge_base.version + 1,
  updated_by = excluded.updated_by,
  updated_at = now();

-- ============================================================================
-- Post-run sanity checks (read-only):
--   select count(*) from public.legal_knowledge_base where entry_type = 'threshold';
--     -- expect 33 (17 before + 16 new)
--   select key, current_value, unit, effective_date, version, updated_by
--     from public.legal_knowledge_base
--    where entry_type = 'threshold' order by key;
--     -- every row but flsa_exempt_salary_threshold should read diana-2026-09-28
-- ============================================================================
