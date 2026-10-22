-- Oct 20 spec, Task A19: record when a missed caller booked a consultation,
-- so the Calls page can count outcomes for any date range. Safe to re-run.
alter table public.lead_recovery add column if not exists consultation_at timestamptz;
create index if not exists lead_recovery_consultation_idx on public.lead_recovery (tenant_id, consultation_at);
