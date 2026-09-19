-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- legal_knowledge_base — spec 3.1, "the versioned legal knowledge base"
-- ----------------------------------------------------------------------------
-- Diana's 3.1: "A maintained, dated table per practice area storing, for each
-- claim type: the correct enforcement path and forum; filing deadlines;
-- canonical citations and what each section says; the current value of every
-- threshold, deadline, and effective date; 'never pair' facts; required
-- qualifiers; and required coverage per topic. Every rule reads from this
-- base. Updating it is a legal task, not an engineering one."
--
-- This migration is the ENGINEERING half only: the table, and a small seed of
-- the values already confirmed in Diana's Sept 18 2026 spec (verbatim from the
-- document, not invented). Everything else — the fuller threshold library,
-- filing deadlines, "never pair" facts for topics beyond wage figures — is
-- explicitly attorney work, seeded here only where the spec already gave a
-- confirmed number so the code has something real to check against on day one.
--
-- Two entry_type shapes share one table because both feed the same two rules
-- built on top of it (3.12 named-act validation, 3.13 value/region/date
-- validation), and a reviewer maintaining "the law facts" wants one place to
-- look, not two:
--   'threshold'  — a numeric fact with a region, a unit, and an effective
--                  date (minimum wage, an overtime salary threshold, a filing
--                  deadline in days). current_value/effective_date is what's
--                  true now; prior_value/prior_effective_date is what was true
--                  immediately before, kept so a draft citing the old figure
--                  with the old date is still recognized as ONCE correct
--                  rather than simply wrong.
--   'named_act'  — a real, verifiable statute or act name + its aliases, so
--                  3.12 has something to check a draft's prose mention of
--                  "the X Act" against. No current_value/effective_date.
--
-- Versioned per spec 3.1's word "dated": every row carries updated_at and a
-- version counter that increments on every re-seed/edit — a single-level
-- history (current + immediately prior), not a full audit log. That covers
-- exactly what 3.13 needs (has the figure changed since a draft was written)
-- without building a separate history table for a fact that changes at most
-- once a year.
--
-- Idempotent. Safe to re-run — seeded rows are matched on
-- (tenant_id, entry_type, key) and updated in place, so re-running this file
-- after an attorney corrects a figure is exactly how that correction ships.
-- ============================================================================

create table if not exists public.legal_knowledge_base (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null default '00000000-0000-0000-0000-000000000001'
                          references public.tenants(id),
  practice_area         text not null,
  jurisdiction          text not null check (jurisdiction in ('federal', 'NY', 'NJ')),
  -- Sub-state split where the law itself splits by region (NY's wage rates
  -- do). Null when the jurisdiction has no such split.
  region                text,
  entry_type            text not null check (entry_type in ('threshold', 'named_act')),
  -- Stable slug, e.g. 'ny_min_wage_downstate' or 'fmla'. Unique with
  -- entry_type so a threshold and an act can't collide even if someone
  -- reuses a short key.
  key                   text not null,
  label                 text not null,
  -- named_act only: other ways a draft might refer to it, checked
  -- case-insensitively by lib/legal-named-acts.ts.
  aliases               text[] not null default '{}',
  canonical_citation    text,
  citation_says         text,
  -- threshold only.
  unit                  text check (unit in ('usd_per_hour', 'usd_per_week', 'usd_per_year', 'days', null)),
  current_value         numeric,
  effective_date        date,
  prior_value           numeric,
  prior_effective_date  date,
  enforcement_path      text,
  required_qualifier    text,
  -- Facts that must never appear paired with this entry's value/region — e.g.
  -- the "rest of state" overtime threshold must never be paired with the
  -- downstate-region dollar figure. Free text, read by a human reviewer today;
  -- 3.13's automated check works off region+key directly rather than parsing
  -- this field, so it degrades gracefully if left blank.
  never_pair_with       text,
  source_url            text,
  notes                 text,
  version               integer not null default 1,
  updated_by            text not null default 'system-seed',
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (tenant_id, entry_type, key)
);

create index if not exists legal_knowledge_base_tenant_lookup_idx
  on public.legal_knowledge_base (tenant_id, entry_type, jurisdiction);

alter table public.legal_knowledge_base enable row level security;
drop policy if exists legal_knowledge_base_tenant on public.legal_knowledge_base;
create policy legal_knowledge_base_tenant on public.legal_knowledge_base
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----------------------------------------------------------------------------
-- Seed — threshold entries, values taken verbatim from Diana's Sept 18 2026
-- spec (the two "verified live" examples in 3.13). Nothing here is invented;
-- an attorney should expand this table with the remaining NY/NJ/federal
-- figures the spec calls for (filing deadlines, the remainder-of-state
-- minimum wage, NJ's own thresholds, etc.).
-- ----------------------------------------------------------------------------
insert into public.legal_knowledge_base
  (practice_area, jurisdiction, region, entry_type, key, label, unit,
   current_value, effective_date, prior_value, prior_effective_date,
   source_url, notes, version, updated_by)
values
  ('employment', 'NY', 'downstate', 'threshold', 'ny_min_wage_downstate',
   'NY minimum wage — NYC, Long Island, Westchester', 'usd_per_hour',
   17.00, '2026-01-01', 16.50, '2025-01-01',
   'https://dol.ny.gov/minimum-wage',
   'Confirmed in Diana''s spec, 2026-09-18: "$17 took effect January 1, 2026." Attorney should add the remainder-of-state rate as a separate row (region ''remainder_of_state'').',
   1, 'diana-spec-2026-09-18'),

  ('employment', 'NY', 'remainder_of_state', 'threshold', 'ny_overtime_exempt_threshold_remainder',
   'NY overtime-exempt salary threshold — remainder of state', 'usd_per_week',
   1199.10, null, null, null,
   'https://dol.ny.gov/minimum-wage',
   'Confirmed in Diana''s spec, 2026-09-18: a draft stating $1,275.00 for "the rest of the state" was wrong; the correct figure for that region is $1,199.10. Effective date not confirmed in the spec — attorney should add it. A downstate-region row should be added separately rather than assuming $1,275.00 is the downstate figure, which the spec does not confirm.',
   1, 'diana-spec-2026-09-18')
on conflict (tenant_id, entry_type, key) do update set
  practice_area = excluded.practice_area,
  jurisdiction = excluded.jurisdiction,
  region = excluded.region,
  label = excluded.label,
  unit = excluded.unit,
  prior_value = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.current_value else public.legal_knowledge_base.prior_value end,
  prior_effective_date = case when public.legal_knowledge_base.current_value is distinct from excluded.current_value
                  then public.legal_knowledge_base.effective_date else public.legal_knowledge_base.prior_effective_date end,
  current_value = excluded.current_value,
  effective_date = excluded.effective_date,
  source_url = excluded.source_url,
  notes = excluded.notes,
  version = public.legal_knowledge_base.version + 1,
  updated_by = excluded.updated_by,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- Seed — named acts. A conservative starter list: real, uncontroversial
-- statutes already referenced elsewhere in this codebase's own seeded traps
-- (supabase/content_known_traps_schema.sql) and legal-classifier.ts's
-- STATUTE_ACRONYM list. Deliberately NOT exhaustive — the point of 3.12 is
-- that anything NOT in this list gets flagged for a human to check, which is
-- the correct, safe behavior for a real act this list hasn't caught up to yet
-- as well as for a fabricated one.
-- ----------------------------------------------------------------------------
insert into public.legal_knowledge_base
  (practice_area, jurisdiction, entry_type, key, label, aliases, canonical_citation, version, updated_by)
values
  ('employment', 'federal', 'named_act', 'fmla', 'Family and Medical Leave Act',
   array['FMLA', 'the Family and Medical Leave Act'], '29 U.S.C. § 2601 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'flsa', 'Fair Labor Standards Act',
   array['FLSA', 'the Fair Labor Standards Act'], '29 U.S.C. § 201 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'title_vii', 'Title VII of the Civil Rights Act of 1964',
   array['Title VII', 'the Civil Rights Act of 1964'], '42 U.S.C. § 2000e et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'ada', 'Americans with Disabilities Act',
   array['ADA', 'the Americans with Disabilities Act'], '42 U.S.C. § 12101 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'adea', 'Age Discrimination in Employment Act',
   array['ADEA', 'the Age Discrimination in Employment Act'], '29 U.S.C. § 621 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'warn_act', 'Worker Adjustment and Retraining Notification Act',
   array['WARN Act', 'the WARN Act'], '29 U.S.C. § 2101 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'cobra', 'Consolidated Omnibus Budget Reconciliation Act',
   array['COBRA', 'the COBRA Act'], '29 U.S.C. § 1161 et seq.', 1, 'system-seed'),
  ('employment', 'federal', 'named_act', 'erisa', 'Employee Retirement Income Security Act',
   array['ERISA', 'the Employee Retirement Income Security Act'], '29 U.S.C. § 1001 et seq.', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'nyshrl', 'New York State Human Rights Law',
   array['NYSHRL', 'New York State Human Rights Law', 'the Human Rights Law'], 'N.Y. Exec. Law § 290 et seq.', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'nychrl', 'New York City Human Rights Law',
   array['NYCHRL', 'New York City Human Rights Law'], 'N.Y.C. Admin. Code § 8-101 et seq.', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'nyll', 'New York Labor Law',
   array['NYLL', 'New York Labor Law'], 'N.Y. Lab. Law', 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'genda', 'Gender Expression Non-Discrimination Act',
   array['GENDA', 'the Gender Expression Non-Discrimination Act'], null, 1, 'system-seed'),
  ('employment', 'NY', 'named_act', 'sonda', 'Sexual Orientation Non-Discrimination Act',
   array['SONDA', 'the Sexual Orientation Non-Discrimination Act'], null, 1, 'system-seed'),
  ('employment', 'NJ', 'named_act', 'njlad', 'New Jersey Law Against Discrimination',
   array['NJLAD', 'New Jersey Law Against Discrimination', 'the Law Against Discrimination'], 'N.J.S.A. 10:5-1 et seq.', 1, 'system-seed'),
  ('employment', 'NJ', 'named_act', 'cepa', 'Conscientious Employee Protection Act',
   array['CEPA', 'the Conscientious Employee Protection Act'], 'N.J.S.A. 34:19-1 et seq.', 1, 'system-seed')
on conflict (tenant_id, entry_type, key) do update set
  label = excluded.label,
  aliases = excluded.aliases,
  canonical_citation = excluded.canonical_citation,
  version = public.legal_knowledge_base.version + 1,
  updated_by = excluded.updated_by,
  updated_at = now();

-- ============================================================================
-- Post-run sanity checks (optional — run manually, read-only):
--   select entry_type, count(*) from public.legal_knowledge_base group by 1;
--   select key, label, current_value, effective_date, version from
--     public.legal_knowledge_base where entry_type = 'threshold';
-- ============================================================================
