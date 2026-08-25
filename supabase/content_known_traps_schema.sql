-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_known_traps — errors the firm has already been caught by once
-- ============================================================================
-- B6: the EEOC/Title VII mistake appeared in both the body and the FAQ of the
-- FMLA post, and nothing could answer "how many other drafts say this". Fixing
-- one instance does not fix the pattern.
--
-- A trap is a SEARCH PATTERN, not a legal fact. That is what makes it buildable
-- ahead of the legal-accuracy feature: it needs no knowledge base, no
-- retrieval, and no judgment about what the law says — only "here is a shape of
-- text that has been wrong before, show me everywhere it appears."
--
-- A hit is a SUSPICION, not a verdict. Most of these patterns match correct
-- writing too — a draft can mention the FMLA and the EEOC together perfectly
-- properly. The output is a reviewer's worklist. Treating a hit as an error
-- would be the same mistake as a green scoreboard, pointed the other way.
--
-- Diana's maintenance loop writes back here: "every real error caught is
-- written into the knowledge base as a known trap, and the batch scan re-checks
-- every draft against the full list."
--
-- Idempotent. Safe to re-run; seeded rows are matched on (tenant_id, label).
-- ============================================================================

create table if not exists public.content_known_traps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001'
                references public.tenants(id),
  label       text not null,
  match_type  text not null default 'all_of'
                check (match_type in ('phrase','regex','all_of','all_of_unless')),
  -- Substring or regex source for phrase/regex; a JSON array of terms for the
  -- all_of forms (a comma-separated list is also accepted, since that is what a
  -- person will type). In the all_of forms a trailing * makes a term a prefix:
  -- "waiv*" matches waiver/waive/waived, while a bare term is bounded on both
  -- sides so "198-c" does not match "198-cx".
  pattern     text not null,
  -- all_of_unless only: terms whose presence clears the hit, so a draft that
  -- already says the right thing stops appearing in the worklist.
  unless      text[] not null default '{}',
  severity    text not null default 'important'
                check (severity in ('critical','important','advisory')),
  -- What is actually wrong, and what the correct statement is. This is the part
  -- a reviewer reads; the pattern is only how the draft was found.
  note        text not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists content_known_traps_tenant_label_idx
  on public.content_known_traps (tenant_id, lower(label));

alter table public.content_known_traps enable row level security;
drop policy if exists content_known_traps_tenant on public.content_known_traps;
create policy content_known_traps_tenant on public.content_known_traps
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Seed: the traps from the August sessions.
--
-- NOT all eight of Diana's seed entries are here, and that is deliberate. Some
-- are conclusions rather than text shapes — "NY election of remedies bars a
-- later court suit" describes a doctrine, not a phrase, and any pattern broad
-- enough to catch it would match half the library. Those are the legal-accuracy
-- feature's job, not a text search's. Seeding a pattern that cannot work would
-- produce a permanently noisy worklist and teach people to ignore it.
-- ---------------------------------------------------------------------------
insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values
  (
    'FMLA paired with EEOC',
    'all_of',
    '["FMLA","EEOC"]',
    '{}',
    'critical',
    'The EEOC does not enforce the FMLA. FMLA claims go to the DOL Wage and Hour Division or straight to court. Check that the draft is not routing an FMLA claim to the EEOC.'
  ),
  (
    'FMLA paired with Title VII',
    'all_of',
    '["FMLA","Title VII"]',
    '{}',
    'critical',
    'The FMLA is not a Title VII statute. Confirm the draft is not treating FMLA rights as arising under Title VII.'
  ),
  (
    'Section 198-c described as an anti-waiver rule',
    'all_of',
    '["198-c","waiv*"]',
    '{}',
    'critical',
    'NYLL 198-c concerns benefits and wage supplements, not waiver of claims. The anti-waiver provision is elsewhere. Check what the draft attributes to 198-c.'
  ),
  (
    'FMLA eligibility cited to section 2611(4)',
    'regex',
    '2611\s*\(\s*4\s*\)',
    '{}',
    'important',
    'Employee eligibility is 29 U.S.C. 2611(2)(B)(ii); 2611(4) defines "employer". Verify the pinpoint cite matches the proposition.'
  ),
  (
    'NYSHRL with an employer-size threshold',
    'all_of',
    '["NYSHRL","four or more"]',
    '{}',
    'critical',
    'Since 8 February 2020 the NYSHRL applies to ALL employers regardless of size. A four-employee threshold is out of date.'
  ),
  (
    'Severe or pervasive stated as the NY standard',
    'all_of_unless',
    '["NYSHRL","severe or pervasive"]',
    '{"eliminated","no longer","2019 amendment","inferior terms"}',
    'critical',
    'The 2019 amendments eliminated the severe-or-pervasive standard under the NYSHRL. Harassment need only rise above petty slights. Flag unless the draft explicitly notes the change.'
  ),
  (
    'EEOC deadline stated as 180 days',
    'all_of',
    '["EEOC","180 days"]',
    '{}',
    'critical',
    'New York is a deferral state: the EEOC charge deadline is 300 days, not 180. Check which deadline the draft gives.'
  ),
  -- Firm-fact rule (Diana 2026-08-25 §6/§7): no content may state or imply how
  -- the firm charges. These are the trap-list view of the same rule the
  -- compliance gate now enforces deterministically (lib/fee-language.ts), so a
  -- reviewer can see the whole library at once rather than one draft at a time.
  (
    'Fee or contingency language',
    'regex',
    '\b(contingency|contingent[-\s]fee|no\s+(fee|fees|cost|costs)\s+unless|you\s+(do\s+not|don''t|will\s+not|won''t)\s+pay\s+(us\s+)?unless|you\s+(pay|owe)\s+nothing\s+unless|no\s+(up[-\s]?front|upfront|out[-\s]?of[-\s]?pocket)\s+(cost|costs|fee|fees))\b',
    '{}',
    'critical',
    'No content may state or imply how the firm charges. Remove contingency and fee-arrangement language entirely. A free initial consultation may be mentioned; fee arrangements may not.'
  ),
  (
    'Outcome guarantee or superlative',
    'regex',
    '\b(maximum compensation|we\s+win|aggressive representation|best\s+(employment\s+)?lawyer|guaranteed?\s+(result|recovery|outcome))\b',
    '{}',
    'critical',
    'No outcome guarantees and no superlatives. Attorney-advertising rules prohibit claims that cannot be substantiated.'
  ),
  (
    'Gender identity or orientation attributed only to the NYCHRL',
    'all_of_unless',
    '["NYCHRL","gender identity"]',
    '{"GENDA","NYSHRL","Bostock","SONDA"}',
    'important',
    'Gender identity and sexual orientation are protected at all three levels — GENDA (2019) and SONDA (2002) under state law, and Bostock (2020) federally. Flag when only the city law is credited.'
  )
on conflict do nothing;
