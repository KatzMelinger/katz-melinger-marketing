-- ============================================================================
-- content_analyses — add attorney-advertising compliance columns
-- ============================================================================
-- Every content draft is now scored for NY/NJ (+ seeded) attorney-advertising
-- compliance as part of the analysis, the same way ad copy already is. The
-- check is ADVISORY: it surfaces a score, a status, specific rule violations,
-- and the disclaimers that must be added — it never blocks publishing.
--
--   compliance_score                 0-100, nullable (null = couldn't compute)
--   compliance_status                'compliant' | 'needs_changes' | 'non_compliant'
--   compliance_violations            jsonb array of { rule, severity, excerpt, reason, fix }
--   compliance_required_disclaimers  jsonb array of disclaimer strings
--   compliance_summary               short executive summary
--
-- All nullable / empty-array defaults so older analysis rows keep loading, and
-- lib/content-analysis.ts gracefully degrades when these columns are missing —
-- so code + SQL can roll out independently.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.content_analyses
  add column if not exists compliance_score integer;

alter table public.content_analyses
  add column if not exists compliance_status text;

alter table public.content_analyses
  add column if not exists compliance_violations jsonb not null default '[]'::jsonb;

alter table public.content_analyses
  add column if not exists compliance_required_disclaimers jsonb not null default '[]'::jsonb;

alter table public.content_analyses
  add column if not exists compliance_summary text not null default '';
