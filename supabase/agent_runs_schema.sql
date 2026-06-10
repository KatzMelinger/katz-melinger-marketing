-- ============================================================================
-- agent_runs — autonomous content agent activity log / approval-inbox source
-- ============================================================================
-- One row per scheduled (or manual) run of the autonomous content agent
-- (lib/agent/content-agent.ts). The agent runs research → draft → analyze →
-- compliance-gate → queue, stopping at the human approval gate. This table is
-- both the audit trail AND the "AI Marketing Employee" activity log the UI
-- reads ("here's what your employee did this week — approve these N items").
--
-- The agent never publishes. Items it produces land in content_drafts at
-- status 'review' (awaiting approval) or 'needs_legal' (held by the compliance
-- hard gate). This table records what was produced, held, and skipped.
--
-- Born tenant-aware with RLS, matching the Phase-4 content pattern.
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  trigger        text not null default 'cron'
                 check (trigger in ('cron', 'manual')),
  status         text not null default 'running'
                 check (status in ('running', 'completed', 'failed')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- [{ keyword, draftId, action, worthScore, compliance, ... }]
  items_produced jsonb not null default '[]'::jsonb,
  -- compliance / legal holds, each with the violations that held it
  items_held     jsonb not null default '[]'::jsonb,
  -- duplicates / below-threshold opportunities the run skipped
  items_skipped  jsonb not null default '[]'::jsonb,
  summary        text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists agent_runs_tenant_started_idx
  on public.agent_runs (tenant_id, started_at desc);

-- RLS — tenant-scoped read/write for authenticated users (the service-role
-- client the cron uses bypasses RLS, so the agent can still write).
alter table public.agent_runs enable row level security;

drop policy if exists "tenant rw agent_runs" on public.agent_runs;
create policy "tenant rw agent_runs"
  on public.agent_runs
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Auto-bump updated_at on any change (reuses the shared trigger fn defined in
-- content_pipeline_schema.sql; create-or-replace here keeps this file runnable
-- standalone too).
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_agent_runs_updated on public.agent_runs;
create trigger touch_agent_runs_updated
  before update on public.agent_runs
  for each row execute function public.tg_touch_updated_at();
