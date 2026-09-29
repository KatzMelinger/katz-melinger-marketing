-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_known_traps — Diana's Sept 28 spec, 11.6 (add) and 11.7 (fix false
-- alarms).
-- ============================================================================
-- Assumes supabase/content_known_traps_schema.sql, _seed_diana_sept8.sql,
-- _nyshrl_broaden.sql and _fmla_pinpoint.sql have already run.
--
-- Every pattern here was tested against the real matcher (lib/known-traps.ts)
-- with realistic positive AND negative sentences before shipping:
--
--   node scripts/run.mjs scripts/check-known-traps-sept28.ts
--
-- That script holds a verbatim copy of every pattern below. If you change a
-- pattern here, change it there too and re-run it.
--
-- WHY MOST OF THESE ARE SENTENCE-SCOPED REGEXES, NOT all_of ROWS
--
-- matchTrap()'s all_of / all_of_unless forms test co-occurrence across the
-- WHOLE draft, and the `unless` list also clears on the whole draft. That is
-- why the old "FMLA paired with EEOC" row fired on any draft naming both, and
-- why the 300-character NYSHRL window reached the next (correct) NYCHRL
-- sentence. The regex branch ignores `unless` entirely, so "same sentence" and
-- "unless" are written into the regex itself, always with this skeleton:
--
--   (?:^|(?<=\n)|(?<=[.!?])(?!\w))    sentence start
--   (?:[^.!?\n]|[.!?](?=\w))          one character inside the sentence; a
--                                     period followed by a word character
--                                     ("$17.00", "U.S.C") does not end it
--   (?=<in-sentence>*?TERM)           TERM appears in the same sentence
--   (?!<in-sentence>*?TERM)           TERM must NOT appear (the "unless")
--   <in-sentence>+                    consume the sentence; the hit excerpt
--                                     is that sentence
--
-- JavaScript RegExp, not Postgres: \b (never \y), lookbehind is allowed.
-- Apostrophes are written [\x27’] so nothing in a pattern needs SQL
-- quote-doubling and the SQL and TS copies are byte-identical.
--
-- Idempotent. New rows: insert ... on conflict do nothing (matched on
-- (tenant_id, lower(label))). Changed rows: explicit UPDATE by label, because
-- a seed's `on conflict do nothing` would never touch an existing row.
-- ============================================================================

begin;

-- ============================================================================
-- 11.7 FIXES to existing rows
-- ============================================================================

-- 11.7a — 'NYSHRL with an employer-size threshold'
-- (live id a64fbe36-6969-4c1d-a894-3fb398eab73c)
-- Was a [^]{0,300} proximity regex in either order, so a correct NYCHRL "four
-- or more" sentence next to any NYSHRL mention fired, including on corrected
-- text. Now: the statute name and the threshold must share ONE sentence, and
-- it clears when that sentence says "all employers" / "regardless of size" or
-- attributes the threshold to the NYCHRL via "..., which applies". "NYC Human
-- Rights Law" is now excluded alongside "City Human Rights Law". Against the
-- live library: 19 drafts before; 14 after, all of which state the four-
-- employee floor for the state law in the flagged sentence.
update public.content_known_traps
   set match_type = 'regex',
       pattern    = '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bNYSHRL\b|(?<!City\s)(?<!City[\x27’]s\s)(?<!NYC\s)\bHuman\s+Rights\s+Law\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?<![\w-])(?:four|4)\s+or\s+more\b|\bat\s+least\s+(?:four|4)\b|\bminimum\s+of\s+(?:four|4)\b|(?<![\w-])(?:four|4)\s+employees\b|\bfewer\s+than\s+(?:four|4)\b|\bmore\s+than\s+(?:four|4)\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\ball\s+employers\b|\bregardless\s+of\s+(?:their\s+|its\s+|the\s+)?(?:employer[\x27’]s\s+)?size\b|\bevery\s+employer\b|\bno\s+(?:minimum\s+)?(?:employee\s+|size\s+)?(?:threshold|minimum)\b|(?:\bNYCHRL\b|\bCity\s+Human\s+Rights\s+Law\b)[^.!?\n]{0,20}\bwhich\s+applies\b))(?:[^.!?\n]|[.!?](?=\w))+',
       unless     = '{}',
       severity   = 'critical',
       note       = 'Since 8 February 2020 the NYSHRL applies to ALL employers regardless of size. A four-employee threshold is out of date; four or more is the New York CITY (NYCHRL) threshold, not the state floor. If the sentence means the NYCHRL, name it. Matched within one sentence only, so a correct NYCHRL sentence nearby no longer trips it.',
       enabled    = true,
       updated_at = now()
 where lower(label) = lower('NYSHRL with an employer-size threshold');

-- 11.7b — 'Firm positioned as representing employers'
-- (live id b5bedae8-6c30-4ac0-9d44-369aa609e596)
-- Fired on 17 drafts, every one of them the CORRECT "The firm does not
-- represent employers." Same verbs as before, now sentence-scoped, and cleared
-- by a negation or "not employers" / "employees only" in the same sentence, or
-- when the sentence is about other lawyers ("Some employment attorneys
-- represent both employees and employers"). Live library after: 0 drafts.
update public.content_known_traps
   set match_type = 'regex',
       pattern    = '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:represents?|defends?)\s+employers\b|\bboth\s+employees\s+and\s+employers\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:does|do|did)\s+not\b|n[\x27’]t\b|\bnever\b|\bnot\s+employers\b|\bonly\s+employees\b|\bemployees\s+only\b|\b(?:some|other|many|most)\s+(?:employment\s+)?(?:attorneys|lawyers|firms)\b|\bmanagement[\s-]+side\b))(?:[^.!?\n]|[.!?](?=\w))+',
       unless     = '{}',
       severity   = 'critical',
       note       = 'Katz Melinger represents employees. Content must never state or imply the firm represents, defends, or works for employers, or represents both sides. "The firm does not represent employers" and "represents employees, not employers" are correct and do not trip this.',
       enabled    = true,
       updated_at = now()
 where lower(label) = lower('Firm positioned as representing employers');

-- 11.7c — 'FMLA paired with EEOC' (live id 7332e514-9112-4d1f-808a-b2f53daf7006)
-- Was all_of ["FMLA","EEOC"] across the whole draft (19 drafts). Kept, but now
-- the non-blocking REVIEW tier: FMLA and the EEOC in the same sentence, where
-- the sentence is not a list of statutes/agencies, is not a negation, and does
-- NOT route an FMLA claim to the EEOC (that shape is the new critical row
-- 'FMLA claim routed to the EEOC' below). The two rows are mutually exclusive.
update public.content_known_traps
   set match_type = 'regex',
       pattern    = '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bADA\b|\bADEA\b|\bFLSA\b|\bNYLL\b|\bAmericans\s+with\s+Disabilities\b|\bAge\s+Discrimination\b|\bFair\s+Labor\s+Standards\b|\bNYSHRL\b|\bNYCHRL\b|\bHuman\s+Rights\s+Law\b|\bNJLAD\b|\bLaw\s+Against\s+Discrimination\b|\bDivision\s+of\s+Human\s+Rights\b|\bDepartment\s+of\s+Labor\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)\s+(?:handles?|enforces?|investigates?|administers?|processes|oversees)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:enforced|handled|investigated|administered|processed|overseen)\s+by\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)))(?:[^.!?\n]|[.!?](?=\w))+',
       unless     = '{}',
       severity   = 'important',
       note       = 'Review: this sentence names both the FMLA and the EEOC. The EEOC does not enforce the FMLA; FMLA claims go to the DOL Wage and Hour Division or straight to court. Usually fine (e.g. "fired after taking FMLA leave or filing an EEOC charge"), but check the sentence is not routing an FMLA claim to the EEOC. Sentences that do route one are caught by the critical row "FMLA claim routed to the EEOC".',
       enabled    = true,
       updated_at = now()
 where lower(label) = lower('FMLA paired with EEOC');

-- 11.7c — 'FMLA paired with Title VII' (live id 7d48e851-da89-484f-8db1-36da49f9a72e)
-- Was all_of ["FMLA","Title VII"] across the whole draft (15 drafts, nearly all
-- "Title VII, the ADA, and the FMLA" lists). Same treatment as the EEOC row:
-- review tier, same sentence, lists and negations excluded, and mutually
-- exclusive with the new critical row 'FMLA claim placed under Title VII'.
update public.content_known_traps
   set match_type = 'regex',
       pattern    = '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bTitle\s+VII\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bADA\b|\bADEA\b|\bFLSA\b|\bNYLL\b|\bAmericans\s+with\s+Disabilities\b|\bAge\s+Discrimination\b|\bFair\s+Labor\s+Standards\b|\bNYSHRL\b|\bNYCHRL\b|\bHuman\s+Rights\s+Law\b|\bNJLAD\b|\bLaw\s+Against\s+Discrimination\b|\bDivision\s+of\s+Human\s+Rights\b|\bDepartment\s+of\s+Labor\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:under|through|via|pursuant\s+to|as\s+part\s+of|part\s+of|arising\s+under)\s+(?:the\s+)?Title\s+VII\b|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:is|are)\s+(?:a\s+)?(?:part\s+of|under|covered\s+by|governed\s+by|enforced\s+under)\s+Title\s+VII\b|\bTitle\s+VII\b\s+(?:governs|covers|includes|enforces)\b(?:[^.!?\n]|[.!?](?=\w)){0,15}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)))(?:[^.!?\n]|[.!?](?=\w))+',
       unless     = '{}',
       severity   = 'important',
       note       = 'Review: this sentence names both the FMLA and Title VII. The FMLA is not a Title VII statute. Usually fine, but check the sentence is not treating FMLA rights as arising under Title VII. Sentences that do are caught by the critical row "FMLA claim placed under Title VII".',
       enabled    = true,
       updated_at = now()
 where lower(label) = lower('FMLA paired with Title VII');

-- ============================================================================
-- 11.6 ADDITIONS (plus the two critical tiers split out of 11.7c)
-- ============================================================================

insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values
  -- 11.7c — critical tier: an FMLA claim/complaint/right filed with, brought
  -- to, or enforced by the EEOC, in one sentence, not negated.
  (
    'FMLA claim routed to the EEOC',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|\b(?:file[sd]?|filing|bring|brings|brought|submit\w*|go|goes)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,40}?\b(?:with|to|at|through|before)\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)|(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)\s+(?:handles?|enforces?|investigates?|administers?|processes|oversees)\b(?:[^.!?\n]|[.!?](?=\w)){0,40}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:enforced|handled|investigated|administered|processed|overseen)\s+by\s+(?:the\s+)?(?:\bEEOC\b|\bEqual\s+Employment\s+Opportunity\s+Commission\b)))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'The EEOC does not enforce the FMLA. FMLA claims are filed with the U.S. Department of Labor Wage and Hour Division or brought directly in court. Remove any statement that an FMLA claim is filed with, brought to, or enforced by the EEOC.'
  ),
  -- 11.7c — critical tier: FMLA claims/rights placed under Title VII.
  (
    'FMLA claim placed under Title VII',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bunlike\b|\binstead\b|\brather\s+than\b|\bseparate\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?:(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:\s+(?:leave|retaliation|interference|discrimination))?\s+(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?|protections?)\b|\b(?:claims?|complaints?|charges?|violations?|cases?|lawsuits?|rights?)\s+(?:under|for|arising\s+under)\s+(?:the\s+)?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?:[^.!?\n]|[.!?](?=\w)){0,80}?\b(?:under|through|via|pursuant\s+to|as\s+part\s+of|part\s+of|arising\s+under)\s+(?:the\s+)?Title\s+VII\b|(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)(?:[^.!?\n]|[.!?](?=\w)){0,60}?\b(?:is|are)\s+(?:a\s+)?(?:part\s+of|under|covered\s+by|governed\s+by|enforced\s+under)\s+Title\s+VII\b|\bTitle\s+VII\b\s+(?:governs|covers|includes|enforces)\b(?:[^.!?\n]|[.!?](?=\w)){0,15}?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b)))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'The FMLA (29 U.S.C. 2601 et seq.) is a separate statute from Title VII. FMLA rights and claims do not arise under Title VII and are not filed "under Title VII". Correct the statute the sentence relies on.'
  ),
  -- 11.6 #1 — NYC Commission on Human Rights deadline stated as three years.
  -- Same sentence: the Commission (or NYCCHR / CCHR) plus three/3 years,
  -- cleared by "one year", "gender-based", or a court/lawsuit/sue in that
  -- sentence (three years to SUE under the NYCHRL is correct). Live library: 19
  -- drafts state a flat three years for the Commission today.
  (
    'NYC Commission on Human Rights deadline stated as three years',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:NYCCHR|CCHR|Commission\s+on\s+Human\s+Rights)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:three|3)[\s-]+years?\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:one|1)[\s-]+year\b|\bgender[\s-]+based\b|\bcourt\b|\blawsuit\b|\bsue\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'The deadline to file with the NYC Commission on Human Rights is generally ONE year; it is three years only for gender-based harassment claims. Three years is the deadline to sue in court under the NYCHRL. Do not state a flat three years for the Commission.'
  ),
  -- 11.6 #2 — what the reader pays, and free / low-cost language. Narrowed
  -- by Kenneth (2026-09-29): attorney fee RECOVERY is a legal remedy and is
  -- allowed ("attorneys' fees and costs are recoverable", "the employer may
  -- have to pay your attorneys' fees", "fee-shifting provision"), so those
  -- phrasings are deliberately absent. "Free consultation" is allowed too.
  (
    'Cost of representation or free / low-cost language',
    'regex',
    '\bwithout\s+(?:having\s+to\s+)?pay(?:ing)?\s+(?:any\s+)?(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\b|\bpay(?:ing)?\s+(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\s+out\s+of\s+pocket\b|\bfree\s+or\s+low[\s-]+cost\b|\bat\s+no\s+cost\b',
    '{}',
    'critical',
    'Content must not say what the reader will or will not pay for representation: no "without paying legal fees out of pocket", "free or low cost" or "at no cost". Attorney fee recovery as a statutory remedy is allowed, and so is "free consultation" (Kenneth, 2026-09-29).'
  ),
  -- 11.6 #3 — outcome figures.
  (
    'Outcome figures or damages-size language',
    'regex',
    '\b(?:six|seven|eight)[\s-]+figures?\b|\btens\s+of\s+thousands\s+of\s+dollars\b|\bsubstantial\s+(?:damages|awards?)\b',
    '{}',
    'critical',
    'Attorney-advertising rules: no outcome sizes ("six-figure", "seven-figure", "tens of thousands of dollars", "substantial damages/awards"). They imply results the firm cannot promise.'
  ),
  -- 11.6 #4 — 196-d tied to the tip credit, same sentence. 196[\s-]?\(?d with
  -- a lookbehind so "196-b" and "1966" never match.
  (
    'Section 196-d tied to the tip credit',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:(?<![\w.])196[\s-]?\(?d\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\btip[\s-]+credits?\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bdoes\s+not\b|\bdoesn[\x27’]t\b|\bnot\s+the\b|\brather\s+than\b|\bseparate(?:ly)?\s+from\b|\bdistinct\s+from\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'NYLL 196-d prohibits employers from demanding, accepting, or keeping any part of an employee''s gratuities. It does not govern the tip credit, which is set by the Hospitality Industry Wage Order (12 NYCRR Part 146).'
  ),
  -- 11.6 #5 — DOL remedies denied.
  (
    'Remedies described as available only through a lawsuit',
    'regex',
    '\b(?:only\s+available|available\s+only)\s+(?:through|in|via|by)\s+(?:(?:a|filing\s+a)\s+)?(?:private\s+)?(?:lawsuit|court)\b',
    '{}',
    'critical',
    'The NY Department of Labor can also order unpaid wages, liquidated damages and interest; these remedies are not available only through a lawsuit. Describe both routes accurately.'
  ),
  -- 11.6 #6 — uniform deductions allowed with consent. Same sentence:
  -- deduct* + uniform* + authoriz*/consent*, cleared by "even if/with/when" or
  -- "prohibit*". "cannot ... unless you authorize" is deliberately NOT a
  -- clearing term, because that sentence is itself the error.
  (
    'Uniform deductions described as allowed with authorization',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bdeduct\w*))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\buniforms?\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bauthori[sz]\w*|\bconsent\w*))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\beven\s+(?:if|with|when)\b|\bprohibit\w*))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'Under NYLL 193 an employer may not deduct the cost of uniforms from wages, even with the employee''s written authorization. Authorization does not make a uniform deduction lawful.'
  ),
  -- 11.6 #7 — personnel-file right in New York. Same sentence: personnel
  -- file/record + "right to"/"entitled to", cleared by any negation, "no
  -- (general) right", public-sector/union context, or another state.
  (
    'Right to see a personnel file stated for New York',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bpersonnel\s+(?:files?|records?)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bright\s+to\b|\bentitled\s+to\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bnever\b|\bno\s+(?:general\s+|legal\s+|statutory\s+)*right\b|\bpublic[\s-]+(?:sector|employees?)\b|\bCalifornia\b|\b(?:other|some)\s+states\b|\bunion\b|\bcollective\s+bargaining\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'New York does not give private-sector employees a general right to see or copy their personnel file (NYLL 195(6) is about pay-rate notices, not personnel files). Do not tell readers they have that right.'
  ),
  -- 11.6 #8 — wage notice / statement damages misstated.
  (
    'Wage notice / statement damages stated as $250 per violation',
    'regex',
    '\$\s?250\s+(?:per|for\s+each|each|a)\s+violation\b',
    '{}',
    'critical',
    'Wage Theft Prevention Act damages are per DAY, not per violation: $50 per day for a missing wage notice and $250 per day for a missing or inaccurate wage statement, each capped at $5,000.'
  ),
  -- 11.6 #9 — minimum wage, NARROWED into three rows (see the report / the
  -- check script). A single regex cannot safely separate a stale NY figure
  -- from NJ ($15.92), federal ($7.25), tipped/cash wages and historical
  -- sentences, so each row is sentence-scoped and conservative. The knowledge-
  -- base value check (lib/legal-value-check.ts) remains the broad net.
  --
  -- 9a: a New York sentence about the minimum wage with a $10.00-$19.99
  -- figure other than $17.00/$16.00, cleared by any year other than 2026,
  -- past tense ("was", "previously"), "from $" (an increase), NJ/federal/FLSA,
  -- or tipped / cash-wage / food-service / home-care context.
  (
    'New York minimum wage stated as a figure other than $17.00 or $16.00',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:New\s+York|NYC|NY|Long\s+Island|Westchester|Nassau|Suffolk)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bminimum\s+(?:hourly\s+)?wage\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\$\s?(?!1[67]\.00\b)1\d\.\d\d\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?!2026\b)(?:19|20)\d\d\b|\b(?:was|were|previously|formerly|prior)\b|\bused\s+to\b|\bfrom\s+\$|\bNew\s+Jersey\b|\bNJ\b|\bfederal\b|\bFLSA\b|\btipped\b|\btip\s+credit\b|\bcash\s+wage\b|\bfood\s+service\b|\bservice\s+(?:employees?|workers?)\b|\bhome\s+(?:care|health)\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'For 2026 the New York minimum wage is $17.00 per hour in New York City, Long Island and Westchester, and $16.00 in the rest of the state. Any other figure stated as current is stale. Check lib/current-facts for the live value.'
  ),
  -- 9b: $16.00 (or $16) stated for NYC / Long Island / Westchester, cleared
  -- when the same sentence also covers the rest of the state or is dated.
  (
    'NYC / Long Island / Westchester minimum wage stated as $16.00',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:New\s+York\s+City|NYC|Long\s+Island|Westchester|Nassau|Suffolk)\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bminimum\s+(?:hourly\s+)?wage\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\$\s?16(?:\.00)?(?!\.?\d)))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?!2026\b)(?:19|20)\d\d\b|\brest\s+of\b|\bremainder\b|\belsewhere\b|\boutside\b|\bupstate\b|\bother\s+(?:parts|areas|counties|regions)\b|\bbalance\s+of\b|\b(?:was|were|previously|formerly)\b|\bfrom\s+\$|\bNew\s+Jersey\b|\bNJ\b|\btipped\b|\btip\s+credit\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    '$16.00 is the 2026 minimum wage for the REST of New York State. In New York City, Long Island and Westchester it is $17.00 per hour.'
  ),
  -- 9c: any figure dated "as of 2025" / "as of January 1, 2025".
  (
    'Figure dated "as of 2025"',
    'regex',
    '\bas\s+of\s+(?:(?:January|Jan\.?)\s+1,?\s+)?2025\b',
    '{}',
    'critical',
    'A figure presented "as of 2025" is stale in 2026 (for example the 2025 NYC minimum wage of $16.50). Replace it with the current figure and date.'
  ),
  -- 11.6 #10 — Title VII caps applied to state law. NARROWED from the spec's
  -- bare "Title VII and the NYSHRL", which matches ordinary correct sentences
  -- ("Title VII and the NYSHRL both prohibit..."). Now: a state-law name and
  -- a cap word / $300,000 in the same sentence, cleared by a negation, "no
  -- cap", "uncapped", "unlimited", "unlike" or "whereas" in that sentence.
  (
    'Title VII damages caps applied to the NYSHRL',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bNYSHRL\b|\b(?:New\s+York\s+)?State\s+Human\s+Rights\s+Law\b|\bstate\s+law\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:caps?|capped)\b|\blimited\s+to\s+\$|\$\s?300,000\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bno\s+(?:\w+\s+)?(?:caps?|limits?)\b|\buncapped\b|\bunlimited\b|\bwithout\s+(?:a\s+|any\s+)?(?:caps?|limits?)\b|\bunlike\b|\bwhereas\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'Title VII''s compensatory and punitive damages caps ($50,000-$300,000 by employer size) do not apply to the NYSHRL or NYCHRL, which have no such caps. Do not describe state or city damages as capped.'
  ),
  -- 11.6 #11 (important) — severe or pervasive with no NY qualifier. Sentence
  -- scope: the spec's whole-draft unless ["federal", ...] would clear almost
  -- every employment draft, since nearly all mention federal law somewhere.
  (
    'Severe or pervasive stated without a New York qualifier',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bsevere\s+(?:or|and\/or)\s+pervasive\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bfederal\b|\bTitle\s+VII\b|\bEEOC\b|\bno\s+longer\b|\bdoes\s+not\s+require\b|\bnot\s+required\b|\bneed\s+not\b|\b(?:does|do|need)\s+not\s+(?:have\s+to\s+|need\s+to\s+)?(?:be|require|meet|show|prove)\b|\bdo(?:es)?n[\x27’]t\s+(?:need|have)\b|\beliminat\w*|\babolish\w*|\binstead\s+of\b|\brather\s+than\b|\bpetty\s+slights\b|\bnot\s+(?:always\s+)?need\b|\bremov\w*|\breject\w*|\b2019\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'important',
    '"Severe or pervasive" is the FEDERAL (Title VII) standard. Since 2019 the NYSHRL, and the NYCHRL before it, require only treatment that is more than petty slights or trivial inconveniences. Say which law the sentence describes, or give the New York standard.'
  ),
  -- 11.6 #12 (important) — FMLA liquidated damages tied to willfulness, one
  -- sentence. Cleared by a limitations-period mention ("two years, three if
  -- willful" legitimately sits next to liquidated damages) or "good faith".
  (
    'FMLA liquidated damages tied to willfulness',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bFMLA\b|\bFamily\s+and\s+Medical\s+Leave\s+Act\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bliquidated\s+damages\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bwillful\w*))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:two|three|2|3)[\s-]+years?\b|\bthree\s+(?:if|for|when|where)\b|\bstatute\s+of\s+limitations\b|\blimitations\s+period\b|\bgood[\s-]+faith\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'important',
    'FMLA liquidated damages are presumptive: they are awarded unless the employer proves good faith and reasonable grounds (29 U.S.C. 2617(a)(1)(A)(iii)). Willfulness affects only the limitations period (three years instead of two), not liquidated damages.'
  ),
  -- 11.6 #13 — FMLA paid-leave substitution denied. Sentence-scoped so NY Paid
  -- Family Leave (where the employer may NOT require PTO use) is excluded.
  (
    'FMLA paid-leave substitution described as prohibited',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:may|can|could)\s*not\s+(?:force|require|make)\s+you\s+(?:to\s+)?(?:exhaust|use\s+up|substitute)\b|\bcan[\x27’]t\s+(?:force|require|make)\s+you\s+(?:to\s+)?(?:exhaust|use\s+up|substitute)\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bPaid\s+Family\s+Leave\b|\bPFL\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'Under the FMLA an employer MAY require an employee to substitute accrued paid leave for unpaid FMLA leave (29 U.S.C. 2612(d)(2)). Do not say the employer cannot make you use or exhaust paid leave during FMLA leave.'
  ),
  -- 11.6 #14 — Paid Family Leave taken to court, one sentence, cleared by a
  -- negation or arbitration / Workers' Compensation Board context.
  (
    'Paid Family Leave claims described as going to court',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\bPaid\s+Family\s+Leave\b|\bPFL\b))(?=(?:[^.!?\n]|[.!?](?=\w))*?(?:\b(?:in|to|into)\s+court\b))(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bnot\b|n[\x27’]t\b|\bcannot\b|\bnever\b|\binstead\b|\barbitrat\w*|\bWorkers[\x27’]?\s+Compensation\s+Board\b|\bWCB\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'critical',
    'New York Paid Family Leave benefit disputes go to arbitration through the insurance carrier, and retaliation complaints go to the Workers'' Compensation Board. They are not taken to court.'
  ),
  -- 11.6 #15 (important) — arbitration of sexual harassment without the EFAA.
  -- Whole-draft all_of_unless on purpose: a draft that explains the EFAA
  -- anywhere has given the reader the correct rule.
  (
    'Arbitration of sexual harassment claims without the EFAA',
    'all_of_unless',
    '["arbitrat*","sexual harassment"]',
    '{"2022","Ending Forced Arbitration","EFAA","court instead"}',
    'important',
    'Since March 2022 the Ending Forced Arbitration of Sexual Assault and Sexual Harassment Act lets employees bring sexual harassment claims in court even if they signed an arbitration agreement. A draft that discusses arbitration of these claims should say so.'
  ),
  -- 11.6 #16 — unfilled placeholders.
  (
    'Unfilled placeholder text',
    'regex',
    '\bPLACEHOLDER\b|\bReplace\s+before\s+publishing\b',
    '{}',
    'critical',
    'The draft still contains template placeholder text ("[PLACEHOLDER]", "Replace before publishing"). Replace it with real, approved content or remove it.'
  ),
  -- 11.6 #17 — schema code in the body.
  (
    'Schema markup pasted into the body',
    'regex',
    'application\/ld\+json|["“]@context["”]',
    '{}',
    'critical',
    'JSON-LD schema markup (application/ld+json, "@context") belongs in the page head via the publish step, not in the article body, where it renders as visible code.'
  ),
  -- 11.6 #18 — old NYC sick leave date.
  (
    'Old NYC sick leave start date (September 30, 2014)',
    'regex',
    '\bSept(?:ember|\.)?\s+30,?\s+2014\b',
    '{}',
    'critical',
    'September 30, 2014 is a 2014 transition date from the original NYC Earned Sick Time Act. Current NYC law is the Earned Safe and Sick Time Act; employees accrue from the first day of employment. Remove the 2014 date.'
  )
on conflict do nothing;

commit;
