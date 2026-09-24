-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Named acts: the false-positive fix (Diana 2.1, 21 Sep).
-- ============================================================================
-- "It also flagged the Equal Pay Act as 'named act could not be verified' — a
-- false positive (the federal Equal Pay Act of 1963 is real)."
--
-- That was a DATA gap, not a logic bug. lib/legal-named-acts.ts flags any
-- act-shaped phrase absent from this table, and the original seed carried 15
-- acts chosen to match legal-classifier.ts's STATUTE_ACRONYM list. Every real
-- statute outside that list — the Equal Pay Act among them — read as
-- unverifiable, which is exactly the noise 2.1 exists to remove.
--
-- This extends the starter list with acts that (a) come up in this firm's
-- employment and wage-and-hour practice and (b) have a standard, unambiguous
-- canonical citation. It is still deliberately NOT exhaustive: per spec 3.1 the
-- knowledge base is attorney-owned, and the safe behaviour for an act nobody has
-- added yet remains "flag it for a human".
--
-- Entries an attorney should confirm before relying on the citation text:
-- these were seeded by engineering from standard references, not from
-- Westlaw. The NAME is what kills the false positive; the citation is metadata
-- and is the part worth a second pair of eyes.
--
-- Idempotent: unique (tenant_id, entry_type, key), so re-running updates.
-- ============================================================================

insert into public.legal_knowledge_base
  (practice_area, jurisdiction, entry_type, key, label, aliases, canonical_citation, version, updated_by)
values
  -- Federal ------------------------------------------------------------------
  ('employment', 'federal', 'named_act', 'equal_pay_act', 'Equal Pay Act of 1963',
   array['Equal Pay Act', 'the Equal Pay Act', 'EPA'], '29 U.S.C. § 206(d)', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'pregnancy_discrimination_act', 'Pregnancy Discrimination Act',
   array['PDA', 'the Pregnancy Discrimination Act'], '42 U.S.C. § 2000e(k)', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'pregnant_workers_fairness_act', 'Pregnant Workers Fairness Act',
   array['PWFA', 'the Pregnant Workers Fairness Act'], '42 U.S.C. § 2000gg et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'gina', 'Genetic Information Nondiscrimination Act',
   array['GINA', 'the Genetic Information Nondiscrimination Act'], '42 U.S.C. § 2000ff et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'rehabilitation_act', 'Rehabilitation Act of 1973',
   array['the Rehabilitation Act', 'Section 504'], '29 U.S.C. § 701 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'nlra', 'National Labor Relations Act',
   array['NLRA', 'the National Labor Relations Act', 'the Wagner Act'], '29 U.S.C. § 151 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'osh_act', 'Occupational Safety and Health Act',
   array['OSH Act', 'the Occupational Safety and Health Act'], '29 U.S.C. § 651 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'userra', 'Uniformed Services Employment and Reemployment Rights Act',
   array['USERRA', 'the Uniformed Services Employment and Reemployment Rights Act'], '38 U.S.C. § 4301 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'civil_rights_act_1866', 'Civil Rights Act of 1866',
   array['Section 1981', 'the Civil Rights Act of 1866'], '42 U.S.C. § 1981', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'ledbetter_act', 'Lilly Ledbetter Fair Pay Act of 2009',
   array['the Lilly Ledbetter Fair Pay Act', 'Ledbetter Act'], '42 U.S.C. § 2000e-5(e)(3)', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'pump_act', 'PUMP for Nursing Mothers Act',
   array['PUMP Act', 'the PUMP Act'], '29 U.S.C. § 218d', 1, 'system-seed'),

  -- New York -----------------------------------------------------------------
  ('employment', 'NY', 'named_act', 'ny_paid_sick_leave', 'New York State Paid Sick Leave Law',
   array['New York Paid Sick Leave', 'NY Paid Sick Leave'], 'N.Y. Labor Law § 196-b', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'nyc_safe_sick_time', 'Earned Safe and Sick Time Act',
   array['ESSTA', 'the Earned Safe and Sick Time Act', 'NYC Paid Safe and Sick Leave Law'],
   'N.Y.C. Admin. Code § 20-911 et seq.', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'ny_warn_act', 'New York State WARN Act',
   array['New York WARN Act', 'NY WARN Act'], 'N.Y. Labor Law § 860 et seq.', 1, 'system-seed'),

  -- New Jersey ---------------------------------------------------------------
  ('employment', 'NJ', 'named_act', 'njfla', 'New Jersey Family Leave Act',
   array['NJFLA', 'the New Jersey Family Leave Act'], 'N.J.S.A. 34:11B-1 et seq.', 1, 'system-seed'),
  ('employment', 'NJ', 'named_act', 'nj_earned_sick_leave', 'New Jersey Earned Sick Leave Law',
   array['the New Jersey Earned Sick Leave Law', 'NJ Earned Sick Leave'],
   'N.J.S.A. 34:11D-1 et seq.', 1, 'system-seed'),
  ('employment', 'NJ', 'named_act', 'nj_wage_theft_act', 'New Jersey Wage Theft Act',
   array['the New Jersey Wage Theft Act', 'NJ Wage Theft Act'], 'N.J.S.A. 34:11-4.1 et seq.', 1, 'system-seed')

on conflict (tenant_id, entry_type, key) do update
  set label              = excluded.label,
      aliases            = excluded.aliases,
      canonical_citation = excluded.canonical_citation,
      updated_at         = now();
