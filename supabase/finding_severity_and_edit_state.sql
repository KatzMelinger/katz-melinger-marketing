-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Item 12: the per-rule severity table, and telling a fix apart from a decision
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. finding_severity_rules — which findings are allowed to hold a draft
-- ---------------------------------------------------------------------------
-- Diana's item 12: "add a severity field to every finding, one of blocker,
-- recommended, optional, mapped per rule in an editable table."
--
-- The defaults live in lib/finding-severity.ts, because a table that ships
-- empty is a feature nobody has configured. This holds the firm's EDITS: one
-- row per rule the firm has moved off its default, layered on top at read time.
-- An empty table therefore means "the defaults are right", not "nothing is
-- classified".
--
-- Keyed by (source, rule_id) — the engine plus its own rule identifier, e.g.
-- ('readability','10') for the first-person rule. rule_id is nullable-as-empty
-- rather than NULL so the unique index works without a partial index: the
-- prose findings that carry no rule id share the key ('aeo','') and are
-- classified per engine, which is the only granularity they have.
-- ---------------------------------------------------------------------------

create table if not exists public.finding_severity_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001'
                references public.tenants(id),
  source      text not null
                check (source in ('readability','seo','aeo','cash','brand_voice',
                                  'linkability','compliance','freshness','structure','legal')),
  rule_id     text not null default '',
  severity    text not null
                check (severity in ('blocker','recommended','optional')),
  -- Why this rule was moved off its default. Read by whoever wonders later.
  note        text,
  updated_at  timestamptz not null default now()
);

create unique index if not exists finding_severity_rules_key_idx
  on public.finding_severity_rules (tenant_id, source, rule_id);

alter table public.finding_severity_rules enable row level security;
drop policy if exists finding_severity_rules_tenant on public.finding_severity_rules;
create policy finding_severity_rules_tenant on public.finding_severity_rules
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Item 13, seeded so it takes effect the moment this runs. The first-person
-- rule fires on "we can help you" — the firm's own house voice — and flooded
-- the panel. It is not a defect, so it is not counted.
insert into public.finding_severity_rules (source, rule_id, severity, note)
values (
  'readability',
  '10',
  'optional',
  'First person (we/our/us) is the firm''s house voice, not a defect. Diana item 13: must not block publishing and must not be counted among blockers.'
)
on conflict (tenant_id, source, rule_id) do update
  set severity = excluded.severity,
      note = excluded.note,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. resolved_by_edit — a content fix is not a status choice
-- ---------------------------------------------------------------------------
-- Diana: "separate finding state: resolved_by_edit (content changed via Apply
-- and Accept) versus dismissed (a status choice), so a status action does not
-- reopen and masquerade as a content fix."
--
-- One `resolved` was carrying two very different events:
--
--   the check stopped reporting it  -> the TEXT changed; the problem is gone
--   a reviewer clicked Resolve      -> a PERSON decided; the text may be identical
--
-- Collapsing them makes "is this actually fixed" unanswerable, and it is the
-- number that says whether the checker is worth trusting. Auto-resolution now
-- writes resolved_by_edit (only a content change can make a check fall silent);
-- the button still writes resolved.
--
-- Existing rows are NOT migrated. Their resolution_note records which path they
-- took, but backfilling a distinction that was not being recorded would be
-- inventing history.
-- ---------------------------------------------------------------------------

alter table public.content_findings
  drop constraint if exists content_findings_status_check;

alter table public.content_findings
  add constraint content_findings_status_check
  check (status in ('open','in_progress','resolved','resolved_by_edit','dismissed'));

comment on column public.content_findings.status is
  'open | in_progress | resolved (a person closed it) | resolved_by_edit (the check stopped reporting it — the content changed) | dismissed (a person chose to stop seeing it).';

-- The partial indexes filter on the two OPEN states, so neither needs changing:
-- resolved_by_edit is a closed state, like resolved and dismissed.
