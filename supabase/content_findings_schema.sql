-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_findings — QA findings as tracked objects, not disposable strings
-- ============================================================================
-- Every check wrote its findings as a string[] column on content_analyses,
-- regenerated wholesale each run. Nothing had an identity, so nothing could
-- carry a state: a finding could not be marked resolved, a week-old problem
-- looked identical to a new one, and re-running the analysis silently replaced
-- the list. That is the mechanism behind a draft being edited and approved
-- while a memo listing seven issues sat somewhere else, untouched.
--
-- A finding is now a row with a stable fingerprint, a status, and a record of
-- who resolved it. Re-running the checks RE-LINKS to these rows rather than
-- replacing them (see reconcileFindings in lib/content-findings.ts), so a
-- reviewer's decisions survive a regenerate.
--
-- The string[] columns on content_analyses are left in place and still written.
-- They drive the existing Apply-to-rewrite flow, which works on finding TEXT;
-- this table is the durable record beside it, not a replacement.
--
-- ============================================================================
-- content_audit_log — what happened to a draft, by whom, and when
-- ============================================================================
-- lib/telemetry.logEvent writes to console and nowhere else, so there was no
-- answer to "who approved this, and what did the checks say at the time".
-- Approvals, publishes, certifications, and finding transitions land here.
--
-- Idempotent. Run in the Supabase SQL editor (after the multitenancy phases,
-- which create public.tenants and public.current_tenant_id()).
-- ============================================================================

create table if not exists public.content_findings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.tenants(id),
  draft_id          uuid not null references public.content_drafts(id) on delete cascade,

  -- Stable identity across re-runs: hash of (source, rule, anchoring text).
  -- Editing the sentence a finding points at yields a different fingerprint,
  -- which is intended — the old finding auto-resolves and a new one is raised
  -- only if the rewrite still breaks the rule.
  fingerprint       text not null,

  source            text not null check (source in (
                      'readability','seo','aeo','cash','brand_voice',
                      'linkability','compliance','freshness','structure','legal'
                    )),
  rule_id           text,
  severity          text not null default 'advisory'
                      check (severity in ('critical','important','advisory')),

  title             text not null,
  detail            text,
  excerpt           text,
  fix               text,

  status            text not null default 'open'
                      check (status in ('open','in_progress','resolved','dismissed')),
  resolved_by       uuid,
  resolved_by_email text,
  resolved_at       timestamptz,
  resolution_note   text,

  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per finding per draft. The re-link on re-analysis depends on this.
create unique index if not exists content_findings_draft_fingerprint_idx
  on public.content_findings (draft_id, fingerprint);
create index if not exists content_findings_draft_idx
  on public.content_findings (draft_id);
-- The "what is still open, worst first" query behind the drawer and any future
-- blocked-work inbox.
create index if not exists content_findings_open_idx
  on public.content_findings (tenant_id, status, severity)
  where status in ('open', 'in_progress');

comment on table public.content_findings is
  'QA findings with a lifecycle. Re-analysis re-links by (draft_id, fingerprint) instead of replacing.';

create table if not exists public.content_audit_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default '00000000-0000-0000-0000-000000000001'
                 references public.tenants(id),
  draft_id     uuid references public.content_drafts(id) on delete cascade,
  event        text not null,
  actor_user_id uuid,
  actor_email  text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists content_audit_log_draft_idx
  on public.content_audit_log (draft_id, created_at desc);
create index if not exists content_audit_log_tenant_idx
  on public.content_audit_log (tenant_id, created_at desc);

comment on table public.content_audit_log is
  'Append-only record of approvals, publishes, certifications, and finding transitions.';

-- ---------------------------------------------------------------------------
-- RLS — same pattern as the rest of the Phase 4 content tables.
-- ---------------------------------------------------------------------------
alter table public.content_findings enable row level security;
alter table public.content_audit_log enable row level security;

drop policy if exists content_findings_tenant on public.content_findings;
create policy content_findings_tenant on public.content_findings
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- The audit log is readable and appendable, never editable: a record that can
-- be rewritten answers nothing. Updates and deletes are simply not granted.
drop policy if exists content_audit_log_read on public.content_audit_log;
create policy content_audit_log_read on public.content_audit_log
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists content_audit_log_append on public.content_audit_log;
create policy content_audit_log_append on public.content_audit_log
  for insert
  with check (tenant_id = public.current_tenant_id());
