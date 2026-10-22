-- Oct 20 spec, Task A17: reliability and monitoring.
--
-- job_runs              one row per scheduled run (and per watchdog retry or
--                       missed-run marker): the System health page, the alerts
--                       and the automatic retry read it.
-- content_draft_versions every saved version of a draft, restorable
--                       ("every saved version of a draft is kept and can be
--                       restored").
--
-- Until this is run the app keeps working: recording a run or a version
-- quietly does nothing, and System health shows "not recorded yet".

create table if not exists public.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,                 -- the cron path, e.g. /api/calls/sync
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'failed')),
  http_status  integer,
  error        text,
  duration_ms  integer,
  trigger      text not null default 'cron' check (trigger in ('cron', 'retry', 'watchdog')),
  alerted      boolean not null default false
);
create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
-- Service role only (no policies): the app reads it server-side.

create table if not exists public.content_draft_versions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  draft_id   uuid not null references public.content_drafts (id) on delete cascade,
  title      text,
  body       text not null,
  content    jsonb,                           -- metadata.content at the time (the article)
  reason     text not null,                   -- "edited", "fix known errors", "improve to ready", ...
  saved_by   text,
  saved_at   timestamptz not null default now()
);
create index if not exists content_draft_versions_draft_idx on public.content_draft_versions (draft_id, saved_at desc);
alter table public.content_draft_versions enable row level security;
-- Service role only (no policies).
