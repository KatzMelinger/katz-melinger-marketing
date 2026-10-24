-- Oct 20 spec, Task A19: the Calls follow-up tables, and when a missed caller
-- booked a consultation (so the Calls page can count outcomes for any range).
-- Run once in the Supabase SQL editor (project ijlesksgnfqqpxtaelqs). Safe to re-run.
--
-- lead_recovery and lead_response_snapshots were defined in
-- scripts/lead-recovery-schema.sql, which was never run on the live database
-- (found 2026-10-24): until now, marking a caller Called back, Reached or Dead
-- on Calls or Lead Response failed, and the weekly leakage snapshot wrote
-- nothing. They are created here first.

create extension if not exists pgcrypto;

-- One row per lost-lead phone: the follow-up status that takes a caller off Needs callback.
create table if not exists public.lead_recovery (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  phone text not null,                     -- normalized last-10 digits (lead identity)
  status text not null default 'new'
    check (status in ('new', 'called_back', 'reached', 'dead')),
  assigned_to text,
  notes text,
  first_lost_at timestamptz,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index if not exists idx_lead_recovery_tenant_status on public.lead_recovery (tenant_id, status);

alter table public.lead_recovery enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'lead_recovery'
                 and policyname = 'Authenticated users have full access to lead_recovery') then
    create policy "Authenticated users have full access to lead_recovery"
      on public.lead_recovery for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Weekly leakage metrics, for the Lead Response trend.
create table if not exists public.lead_response_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  snapshot_date date not null,
  window_days int not null default 30,
  total_leads int not null default 0,
  leads_connected int not null default 0,
  connect_rate_pct numeric(5, 1) not null default 0,
  missed_first_contact int not null default 0,
  recovered int not null default 0,
  lost int not null default 0,
  first_time_caller_lost int not null default 0,
  after_hours_lost int not null default 0,
  estimated_lost_value numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, snapshot_date, window_days)
);
create index if not exists idx_lead_snapshots_tenant_date on public.lead_response_snapshots (tenant_id, snapshot_date desc);

alter table public.lead_response_snapshots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'lead_response_snapshots'
                 and policyname = 'Authenticated users have full access to lead_response_snapshots') then
    create policy "Authenticated users have full access to lead_response_snapshots"
      on public.lead_response_snapshots for all to authenticated using (true) with check (true);
  end if;
end $$;

-- updated_at on lead_recovery.
create or replace function public.set_lead_recovery_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end
$fn$;
drop trigger if exists trg_lead_recovery_updated on public.lead_recovery;
create trigger trg_lead_recovery_updated before update on public.lead_recovery
  for each row execute function public.set_lead_recovery_updated_at();

-- Task A19: when a missed caller booked a consultation.
alter table public.lead_recovery add column if not exists consultation_at timestamptz;
create index if not exists lead_recovery_consultation_idx on public.lead_recovery (tenant_id, consultation_at);

-- Make the new tables visible to the API at once.
notify pgrst, 'reload schema';
