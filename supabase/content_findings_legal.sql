-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_findings — the four columns the legal layer needs (Diana §8)
-- ============================================================================
-- A legal finding has to record more than "something is wrong here". Diana's
-- spec: the claim text, its location, a TYPE, a reason, the SOURCE CHECKED,
-- the JURISDICTION, a status, the RESOLUTION, and who resolved it and when.
--
-- The existing table already carries claim text (title/excerpt), location
-- (excerpt + fingerprint), reason (detail), status, and who/when. These four
-- are what is missing.
--
-- All four are nullable and unused by every existing finding source. The
-- readability, SEO, CASH and compliance checks keep writing exactly what they
-- write today; only the legal layer populates these.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.content_findings
  -- WHICH BUCKET the claim fell into. This is the classifier's verdict, and it
  -- is the single most important field for auditing whether the legal layer is
  -- behaving: if `factual_mismatch` grows while `interpretation` stays flat,
  -- the classifier has started auto-checking things it should be routing to a
  -- human, which is the failure mode that produces a confident wrong answer.
  add column if not exists claim_type text
    check (claim_type is null or claim_type in (
      'factual_mismatch',    -- a number, date, or citation that does not match the source
      'interpretation',      -- what the law means, whether it applies, how enforced
      'negative_statement',  -- "X does not apply" — no source states a negative
      'firm_claim',          -- a statement about Katz Melinger itself
      'unclassified'         -- the classifier could not decide; always a human
    )),

  -- The authority actually consulted, as a URL. Null for interpretation and
  -- negative statements, which are not verifiable by lookup — and that null is
  -- meaningful: a finding claiming to be factual with no source checked is a
  -- finding that was never really verified.
  add column if not exists source_checked text,

  -- federal | NY | NJ. Which body of law the claim sits under, so a reviewer
  -- is not left inferring it and so the retrieval layer knows which sources
  -- were even applicable.
  add column if not exists jurisdiction text
    check (jurisdiction is null or jurisdiction in ('federal', 'NY', 'NJ')),

  -- WHAT THE REVIEWER DID, as one of three typed outcomes rather than free
  -- text. resolution_note stays for the reviewer's own words; this is the
  -- structured answer, so "how often is a flag approved as-is" is a question
  -- with an answer. A high approved_as_is rate means the checker is too noisy.
  add column if not exists resolution text
    check (resolution is null or resolution in ('fixed', 'approved_as_is', 'removed'));

comment on column public.content_findings.claim_type is
  'Legal layer: which bucket the classifier put the claim in. Null for non-legal findings.';
comment on column public.content_findings.source_checked is
  'Legal layer: the authority URL consulted. Null when the claim is not verifiable by lookup.';
comment on column public.content_findings.jurisdiction is
  'Legal layer: federal | NY | NJ.';
comment on column public.content_findings.resolution is
  'Legal layer: fixed | approved_as_is | removed. Structured counterpart to resolution_note.';

-- The Legal Review queue: open legal findings, worst first, for one attorney.
create index if not exists content_findings_legal_open_idx
  on public.content_findings (tenant_id, source, status, severity)
  where source = 'legal' and status in ('open', 'in_progress');
