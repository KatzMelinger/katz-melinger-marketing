-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Rules can be upgraded without new code — Diana's Oct 6 2026 spec, Task 24.
--
-- 1. rule_changes: one history row per change to a brand constant, a trap or
--    a knowledge base entry: who, when, old value, new value. Restore writes
--    the old value back as a new change, so history is never rewritten.
--
--    Knowledge base changes do not apply on save (Kenneth, 2026-10-06,
--    decision D): they are stored here with status 'pending' and only reach
--    legal_knowledge_base when a reviewing attorney approves them.
--    Brand constants and traps apply at once (status 'applied').
--
-- 2. Every rule carries source_url, effective_date and last_verified:
--    content_known_traps gains all three (a trap with a future effective_date
--    does not run until that date); legal_knowledge_base gains last_verified,
--    plus scheduled_value / scheduled_effective_date for a figure that is
--    known now but takes effect later (a January 1 minimum wage). The loader
--    switches it in on that date, no job needed.
--
-- Idempotent. Run once; re-running changes nothing.
-- ============================================================================

begin;

create table if not exists public.rule_changes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default '00000000-0000-0000-0000-000000000001'
                       references public.tenants(id),
  rule_kind          text not null check (rule_kind in ('brand', 'trap', 'kb')),
  -- brand: the settings key; trap: the trap id; kb: the entry key
  -- (entry_type:key, e.g. 'threshold:nj_min_wage').
  rule_ref           text not null,
  rule_label         text not null,
  action             text not null check (action in ('create', 'update', 'enable', 'disable', 'restore', 'verify')),
  old_value          jsonb,
  new_value          jsonb,
  status             text not null default 'applied' check (status in ('applied', 'pending', 'rejected')),
  changed_by_email   text,
  changed_at         timestamptz not null default now(),
  -- kb only: the attorney asked to approve, and who decided.
  reviewer_email     text,
  decided_by_email   text,
  decided_at         timestamptz,
  decision_note      text,
  -- A restore points at the change whose old value it put back.
  restored_from      uuid references public.rule_changes(id)
);

create index if not exists rule_changes_ref_idx
  on public.rule_changes (tenant_id, rule_kind, rule_ref, changed_at desc);
create index if not exists rule_changes_pending_idx
  on public.rule_changes (tenant_id, status) where status = 'pending';

alter table public.rule_changes enable row level security;
drop policy if exists rule_changes_tenant on public.rule_changes;
create policy rule_changes_tenant on public.rule_changes
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

alter table public.content_known_traps
  add column if not exists source_url     text,
  add column if not exists effective_date date,
  add column if not exists last_verified  date;

alter table public.legal_knowledge_base
  add column if not exists last_verified            date,
  add column if not exists scheduled_value          numeric,
  add column if not exists scheduled_effective_date date;

-- Seeded entries were checked when they were loaded.
update public.legal_knowledge_base
   set last_verified = coalesce(last_verified, updated_at::date)
 where last_verified is null;

commit;
