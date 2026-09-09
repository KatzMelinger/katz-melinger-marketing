-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_known_traps — seed from Diana's Huraqan Social Media build spec,
-- Sept 8 2026, Part 7 ("Known traps, paste-ready").
--
-- Assumes supabase/content_known_traps_schema.sql already ran (the table and
-- its seed from the August sessions). Two of Part 7's items are already
-- covered by that seed and are deliberately NOT repeated here:
--   - "EEOC deadline in New York" (300 vs 180 days) — 'EEOC deadline stated as 180 days'
--   - "NYSHRL coverage" (all employers regardless of size) — 'NYSHRL with an employer-size threshold'
-- The social phone number trap ("646-466-6267, flag 212-460-0047") is also not
-- seeded here — it's enforced as a hard block specifically on social content
-- by lib/social-compliance.ts's wrong_phone rule, which is a better fit than a
-- library-wide worklist item for a social-only number.
--
-- "Years of experience" (flag any mismatch between 20 and 50 years) is not
-- seeded either — a trap needs a known-wrong shape to search for, and this one
-- has no single correct figure to check against; it needs a real cross-draft
-- consistency check, which content_known_traps' plain per-draft text search
-- cannot do. Left as a follow-up, not guessed at here.
--
-- Idempotent. Safe to re-run; seeded rows are matched on (tenant_id, label).
-- ============================================================================

insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values
  (
    'NYSDHR sexual harassment deadline stated as 1 year',
    'all_of',
    '["NYSDHR","1 year"]',
    '{}',
    'critical',
    'The NYSDHR sexual harassment filing deadline is 3 years, not 1. Check the figure attributed to NYSDHR.'
  ),
  (
    'Tip pooling described as voluntary',
    'all_of',
    '["tip pool*","voluntary"]',
    '{}',
    'important',
    'An employer may require tip pooling among eligible tipped employees — it is not voluntary. Managers, supervisors, and owners cannot share in the pool regardless.'
  ),
  (
    'Whistleblower / False Claims Act share stated as 33% or a conviction',
    'regex',
    '\b33\s*(%|percent\b).{0,60}(whistleblow|false claims)|(whistleblow|false claims).{0,80}\bconviction\b',
    '{}',
    'critical',
    'The False Claims Act relator share is 15-25% if the government intervenes, 25-30% if it declines — a civil recovery, not a conviction. Check the figure and the framing.'
  ),
  (
    'New York overtime salary threshold cited as a fixed dated figure',
    'phrase',
    '$1,300 per week',
    '{}',
    'critical',
    'The New York overtime salary threshold changes over time — use the current figure from the knowledge base, not a fixed dated number that will go stale.'
  ),
  (
    'Vacated federal overtime rule cited as current',
    'phrase',
    '$43,888',
    '{}',
    'critical',
    'The federal $43,888 overtime salary threshold was vacated in November 2024. Do not state it as a current figure.'
  ),
  (
    'New York minimum wage stated as an old figure',
    'regex',
    '\$15\.00\b|\$14\.00\b|\$16\.50\b',
    '{"2026"}',
    'important',
    'New York minimum wage figures change; $15.00 / $14.00 / $16.50 read as stale. Confirm the draft uses the current 2026 figure and is not stating an old one as current.'
  ),
  (
    'Farmworker overtime threshold stated as 60 hours current',
    'all_of',
    '["farmworker*","60 hours"]',
    '{}',
    'important',
    'The farmworker overtime threshold steps down over time. A bare "60 hours" stated as the current rule is likely stale — check against the current knowledge base figure.'
  ),
  (
    'Counties served include Norfolk County',
    'phrase',
    'Norfolk County',
    '{}',
    'critical',
    'The firm serves Nassau, Suffolk, and Westchester counties. Norfolk County is not one of them — likely a mix-up with a same-named county elsewhere.'
  ),
  (
    'New Jersey agency named as Department of Civil Rights',
    'phrase',
    'New Jersey Department of Civil Rights',
    '{}',
    'important',
    'The correct name is the New Jersey Division on Civil Rights, not the Department of Civil Rights.'
  ),
  (
    'ADA coverage stated as more than 15 employees',
    'phrase',
    'more than 15 employees',
    '{}',
    'important',
    'ADA coverage applies to 15 OR MORE employees, not "more than 15" — that phrasing excludes employers with exactly 15.'
  ),
  (
    'Firm positioned as representing employers',
    'regex',
    '\b(represents?|defends?)\s+employers\b|\bboth employees and employers\b',
    '{}',
    'critical',
    'Katz Melinger represents employees. Content must never state or imply the firm represents, defends, or works for employers, or represents both sides.'
  ),
  (
    'Firm name misstated',
    'regex',
    'Katz Melinger,\s*PLLC|Katz Melinger PLLG',
    '{}',
    'important',
    'The firm name is "Katz Melinger PLLC" — no comma before PLLC, and never "PLLG".'
  )
on conflict do nothing;
