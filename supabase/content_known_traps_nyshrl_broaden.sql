-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Broaden the NYSHRL employer-size trap so it catches the copy it was written
-- for.
-- ============================================================================
-- The trap was seeded in August as all_of ["NYSHRL","four or more"], and in
-- September the pregnancy set stated a New York employer minimum of four
-- employees and was not caught. Wiring the trap into the approval gate alone
-- would not have caught it either, because the pattern never matched:
--
--   "Under the NYSHRL, employers with four or more employees"        -> fired
--   "Under the New York State Human Rights Law, four or more ..."    -> MISSED
--   "the NYSHRL covers employers with at least four employees"       -> MISSED
--   "the Human Rights Law applies to employers with four employees"  -> MISSED
--
-- all_of is literal co-occurrence: every term must appear verbatim. Marketing
-- copy spells the statute out rather than using the acronym, and writes the
-- threshold a dozen ways. A trap that only matches one phrasing of each is a
-- trap that only catches the draft it was written from.
--
-- So this becomes a regex with two axes — how the statute is named, and how a
-- size threshold is written — within 300 characters of each other in either
-- order. Proximity rather than whole-document co-occurrence: a blog that
-- mentions the statute in paragraph 2 and "four employees" in an unrelated
-- example in paragraph 9 is not making the claim.
--
-- The one subtlety is that "four or more employees" IS correct for New York
-- City. A bare "Human Rights Law" therefore only counts as the state law when
-- New York City does not own it, which the two lookbehinds enforce. NYCHRL and
-- "New York City Human Rights Law" are deliberately absent from the name list.
--
-- Verified against 14 cases before shipping — 8 phrasings that must fire
-- (including both orders and across a paragraph break) and 6 that must not
-- (correct copy, the NYC threshold in both plain and possessive form, a
-- coincidental "four employees" 600 characters away, the Title VII 15-employee
-- rule, and the statute named with no threshold at all).
--
-- Idempotent: updates the existing row by label, inserts it if absent.
-- ============================================================================

insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values (
  'NYSHRL with an employer-size threshold',
  'regex',
  '(NYSHRL|(?<!City )(?<!City''s )Human Rights Law)[^]{0,300}?(four or more|4 or more|at least four|at least 4|minimum of four|minimum of 4|four employees|4 employees|fewer than four|fewer than 4|more than four|more than 4)|(four or more|4 or more|at least four|at least 4|minimum of four|minimum of 4|four employees|4 employees|fewer than four|fewer than 4|more than four|more than 4)[^]{0,300}?(NYSHRL|(?<!City )(?<!City''s )Human Rights Law)',
  '{}',
  'critical',
  'Since 8 February 2020 the NYSHRL applies to ALL employers regardless of size. A four-employee threshold is out of date — that figure is the New York CITY threshold, not the state floor. If the draft means the NYCHRL, say so explicitly.'
)
on conflict (tenant_id, lower(label)) do update
  set match_type = excluded.match_type,
      pattern    = excluded.pattern,
      unless     = excluded.unless,
      severity   = excluded.severity,
      note       = excluded.note,
      enabled    = true,
      updated_at = now();
