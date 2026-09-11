-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- legal_kb_entries — the versioned legal knowledge base (Diana item 11)
-- ============================================================================
-- "A dated table per practice area holding, per claim type, the correct
-- enforcement path and forum, filing deadlines, canonical citations and what
-- each section says, current thresholds and effective dates, never-pair facts,
-- required qualifiers, and required coverage."
--
-- WHY THIS IS A TABLE AND NOT A PROMPT
--
-- The four rule classes it feeds (R1 wrong authority, R2 missing qualifier,
-- R3 fact and citation validation, R4 completeness) are lookups, not judgement
-- calls. A model asked "is Article 6 the right cite for the overtime rule"
-- gives a confident answer either way and cannot be audited. A row that says
-- the canonical citation is 12 NYCRR 142 can be read, corrected, and dated by
-- an attorney — which is the only version of this an attorney should sign.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--
-- Interpretation. Every entry here is a fact a person could look up. Anything
-- requiring legal reasoning stays with lib/legal-verify.ts (which routes it to
-- a human) — Diana's "single lookupable facts can be auto checked against the
-- base, anything interpretive routes to a human".
--
-- VERSIONING
--
-- `version` and `effective_from` make an entry a dated statement rather than a
-- standing one. When a threshold changes the old row is superseded, not
-- overwritten, so a draft written last year can still be judged against the law
-- as it stood — and so "what did we believe on this date" has an answer.
-- ============================================================================

create table if not exists public.legal_kb_entries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.tenants(id),

  -- Scope ------------------------------------------------------------------
  practice_area   text not null,                    -- employment | collections
  claim_type      text not null,                    -- overtime | minimum_wage | discrimination …
  jurisdiction    text not null,                    -- federal | NY | NJ
  topic           text not null,                    -- stable slug, e.g. ny-overtime-rate
  label           text not null,                    -- what a reviewer reads

  -- Which drafts this entry applies to. Substring-matched, lowercased.
  match_keywords  text[] not null default '{}',

  -- R1: wrong authority or forum -------------------------------------------
  enforcement_path text,                            -- e.g. 'NYSDOL complaint or civil action'
  forum            text,                            -- e.g. 'NY Supreme Court; NYSDOL'
  filing_deadline  text,                            -- e.g. '6 years (NYLL 198(3))'
  canonical_citation text,                          -- e.g. '12 NYCRR 142'
  citation_says    text,                            -- what that section ACTUALLY says
  -- Citations the firm has seen used wrongly FOR THIS TOPIC. A hit is R1.
  wrong_citations  text[] not null default '{}',

  -- R2: missing qualifier or overbroad -------------------------------------
  -- Phrases that must appear somewhere near the topic for the statement to be
  -- accurate ("most employees", "non-exempt", "unless an exemption applies").
  required_qualifiers text[] not null default '{}',

  -- R3: fact and citation validation ---------------------------------------
  current_value   text,                             -- '$1,200.00'
  value_unit      text,                             -- 'week' | 'hour' | 'year' | ''
  -- How the value is arrived at, when it is arrived at rather than published.
  -- {"formula":"75 x weekly minimum wage","fromFactId":"ny-min-wage-upstate-2026",
  --  "multiplier":75,"basis":"hour"} — lets R3 check a stated figure against the
  -- derivation as well as against current_value, which is how a stale figure in
  -- our OWN facts table gets caught rather than validated.
  derivation      jsonb,
  -- Facts that must never appear together (each: {"a": "...", "b": "...", "why": "..."}).
  never_pair      jsonb not null default '[]'::jsonb,

  -- R4: completeness --------------------------------------------------------
  -- Things a draft on this topic must cover to not mislead by omission.
  required_coverage text[] not null default '{}',

  -- Versioning --------------------------------------------------------------
  version         integer not null default 1,
  effective_from  date not null default current_date,
  effective_to    date,
  source_url      text,
  verified_by     text,
  verified_at     timestamptz,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists legal_kb_entries_topic_version_idx
  on public.legal_kb_entries (tenant_id, topic, version);

create index if not exists legal_kb_entries_active_idx
  on public.legal_kb_entries (tenant_id, practice_area, jurisdiction)
  where enabled and effective_to is null;

alter table public.legal_kb_entries enable row level security;
drop policy if exists legal_kb_entries_tenant on public.legal_kb_entries;
create policy legal_kb_entries_tenant on public.legal_kb_entries
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Seed: the two errors from Diana's Unpaid Wages review, and nothing else.
--
-- Deliberately small. A knowledge base seeded with everything an LLM can
-- produce about New York wage law is a knowledge base nobody verified, and its
-- whole value is that an attorney can stand behind each row. These two are the
-- ones with a documented error to catch; the rest get added as they are
-- confirmed, which is also how content_known_traps grew.
-- ---------------------------------------------------------------------------

insert into public.legal_kb_entries (
  practice_area, claim_type, jurisdiction, topic, label, match_keywords,
  enforcement_path, forum, filing_deadline, canonical_citation, citation_says,
  wrong_citations, required_qualifiers, required_coverage, source_url
)
values (
  'employment',
  'overtime',
  'NY',
  'ny-overtime-rate',
  'New York overtime rate and where the rule lives',
  array['overtime', 'time and a half', 'time-and-a-half', 'over 40 hours', 'forty hours'],
  'NYSDOL wage claim, or a civil action under NYLL 198',
  'New York State Department of Labor; NY Supreme Court; SDNY/EDNY for FLSA claims',
  '6 years for NYLL wage claims (NYLL 198(3)); 2 years FLSA, 3 if willful',
  '12 NYCRR 142-2.2',
  'The Miscellaneous Industries wage order sets the overtime rate at one and one-half times the employee''s regular rate for hours over 40 in a workweek.',
  -- The error Diana found: Article 6 is the wage-PAYMENT article. It governs
  -- how and when wages must be paid, not the overtime rate.
  array['Article 6', 'NYLL Article 6', 'Labor Law Article 6', 'NY Labor Law Article 6'],
  array['non-exempt', 'nonexempt', 'unless an exemption applies', 'most employees'],
  array['the 40-hour workweek threshold', 'that exempt employees are not covered'],
  'https://dol.ny.gov/minimum-wage-0'
)
on conflict (tenant_id, topic, version) do update
  set label = excluded.label,
      match_keywords = excluded.match_keywords,
      enforcement_path = excluded.enforcement_path,
      forum = excluded.forum,
      filing_deadline = excluded.filing_deadline,
      canonical_citation = excluded.canonical_citation,
      citation_says = excluded.citation_says,
      wrong_citations = excluded.wrong_citations,
      required_qualifiers = excluded.required_qualifiers,
      required_coverage = excluded.required_coverage,
      source_url = excluded.source_url,
      updated_at = now();

insert into public.legal_kb_entries (
  practice_area, claim_type, jurisdiction, topic, label, match_keywords,
  canonical_citation, citation_says, current_value, value_unit, derivation,
  required_qualifiers, source_url
)
values (
  'employment',
  'overtime',
  'NY',
  'ny-exempt-salary-threshold-upstate',
  'NY exempt salary threshold, rest of state (weekly)',
  array['salary threshold', 'exempt threshold', 'exemption threshold', 'exempt salary',
        'salary basis', 'salary level'],
  '12 NYCRR 142-2.14',
  'The executive and administrative exemptions require a salary of at least 75 times the applicable minimum hourly wage.',
  -- Left NULL on purpose. lib/current-facts.ts holds $1,199.10 and Diana's
  -- review says the formula gives $1,200.00 — the two disagree, and which is
  -- right is an attorney's call, not a migration's. The derivation below is
  -- what makes R3 REPORT the disagreement instead of either figure silently
  -- winning. Fill this in once it is settled.
  null,
  'week',
  '{"formula": "75 x the applicable minimum hourly wage",
    "fromFactId": "ny-min-wage-upstate-2026",
    "multiplier": 75,
    "basis": "hour"}'::jsonb,
  array['rest of the state', 'outside New York City', 'upstate'],
  'https://dol.ny.gov/minimum-wage-0'
)
on conflict (tenant_id, topic, version) do update
  set label = excluded.label,
      match_keywords = excluded.match_keywords,
      canonical_citation = excluded.canonical_citation,
      citation_says = excluded.citation_says,
      value_unit = excluded.value_unit,
      derivation = excluded.derivation,
      required_qualifiers = excluded.required_qualifiers,
      source_url = excluded.source_url,
      updated_at = now();
