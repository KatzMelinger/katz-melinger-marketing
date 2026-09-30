-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Attorney review of the legal tables, 2026-09-30.
--
-- 1. OSHA section 11(c) has no private right of action: only the Secretary of
--    Labor sues. The statute table (supabase/legal_statute_table.sql, re-run
--    it) now catches a sentence that CITES 11(c) / 29 U.S.C. § 660(c) and says
--    the employee can sue. This trap catches the same claim when no section is
--    cited ("You can sue your employer for OSHA retaliation"). Important, not
--    critical: it routes to a person rather than blocking the draft.
--
-- Pattern is one sentence long and cannot reach across a sentence boundary.
-- Tested by scripts/check-osha-trap.ts, which reads the pattern from THIS file.
-- Idempotent.
-- ============================================================================

insert into public.content_known_traps (label, match_type, pattern, unless, severity, note)
values
  (
    'OSHA retaliation described as a private lawsuit',
    'regex',
    '(?:^|(?<=\n)|(?<=[.!?])(?!\w))(?=(?:[^.!?\n]|[.!?](?=\w))*?\b(?:OSHA|OSH\s+Act|Occupational\s+Safety\s+and\s+Health\s+Act)\b)(?=(?:[^.!?\n]|[.!?](?=\w))*?(?<![A-Za-z])(?:sue|sued|suing|lawsuit|lawsuits|in\s+court)\b)(?!(?:[^.!?\n]|[.!?](?=\w))*?(?:\bSecretary\b|\bno\s+private\b|\bcannot\s+sue\b|\bcan[’\x27]t\s+sue\b|\bmay\s+not\s+sue\b|\b740\b|\bLabor\s+Law\b))(?:[^.!?\n]|[.!?](?=\w))+',
    '{}',
    'important',
    'OSHA section 11(c) (29 U.S.C. § 660(c)) gives employees no private right to sue. The employee files a complaint with OSHA within 30 days, and only the Secretary of Labor may sue. For a private lawsuit, private-sector workers in New York generally use Labor Law § 740 (attorney review, 2026-09-30).'
  )
on conflict do nothing;

select label, severity, enabled from public.content_known_traps
 where label = 'OSHA retaliation described as a private lawsuit';
