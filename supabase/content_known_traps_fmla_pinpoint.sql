-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Raise the FMLA eligibility pinpoint to a critical trap (Diana 1A, 21 Sep).
-- ============================================================================
-- Diana's done-when: the FMLA retaliation draft must raise a CRITICAL
-- legal-accuracy finding on the "29 U.S.C. § 2611(4)(A)(i)" pinpoint. The
-- existing trap ('FMLA eligibility cited to section 2611(4)') matches the
-- broader 2611(4) and is seeded 'important', so the draft was held only by the
-- Attorney Advertising gate.
--
-- That broad trap is deliberately left alone, and left at 'important', because
-- 2611(4) is NOT wrong on its own: it is the definition of "employer", and a
-- draft that cites it for the 50-employee employer threshold is correct. A
-- blanket critical on 2611(4) would block accurate copy.
--
-- What IS reliably wrong is the pairing Diana found: the 50-employees/75-mile
-- ELIGIBILITY rule attributed to the employer-definition subsection. Employee
-- eligibility — including the 75-mile radius — is 29 U.S.C. § 2611(2)(B)(ii).
--
-- Hence all_of_unless rather than a regex: the hit is the specific pinpoint
-- 2611(4)(A)(i), and it clears automatically when the draft ALSO cites
-- 2611(2). A blog that explains the distinction between the two subsections
-- necessarily names both, and that is accurate legal writing, not an error —
-- the same "cleared by the correct phrasing" shape as the EEOC 180/300-day
-- trap seeded in August.
--
-- all_of_unless also keeps this pattern free of regex entirely, so there is no
-- escaping to get wrong between here and Postgres.
--
-- Idempotent: updates the existing row by label, inserts it if absent.
-- ============================================================================

insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values (
  'FMLA eligibility cited to the employer-definition pinpoint',
  'all_of_unless',
  '["2611(4)(A)(i)"]',
  '{"2611(2)"}',
  'critical',
  'Employee eligibility under the FMLA — the 12 months of service, 1,250 hours, and the 50-employees-within-75-miles rule — is 29 U.S.C. 2611(2)(B)(ii). Section 2611(4) defines "employer", and 2611(4)(A)(i) is the 50-employee clause of that definition, not the eligibility test. Cite 2611(2)(B)(ii) for who is an eligible employee. Cleared automatically when the draft also cites 2611(2), because a piece explaining the difference between the two subsections will name both.'
)
on conflict (tenant_id, lower(label)) do update
  set match_type = excluded.match_type,
      pattern    = excluded.pattern,
      unless     = excluded.unless,
      severity   = excluded.severity,
      note       = excluded.note,
      enabled    = true,
      updated_at = now();
