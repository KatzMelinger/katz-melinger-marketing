-- ============================================================================
-- content_pipeline — owner + status_updated_at
-- ============================================================================
-- Adds:
--   * owner_user_id      uuid  — references app_users (the person responsible
--                                  for moving this item along). Nullable so
--                                  items can be unassigned.
--   * status_updated_at  timestamptz — auto-bumped whenever the status column
--                                       actually changes. Lets the UI show
--                                       "in Review since 2026-05-12" without
--                                       conflating it with the touch-every-edit
--                                       updated_at column.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project after content_pipeline_schema.sql.
-- ============================================================================

alter table public.content_pipeline
  add column if not exists owner_user_id uuid
    references public.app_users (user_id) on delete set null;

alter table public.content_pipeline
  add column if not exists status_updated_at timestamptz not null default now();

create index if not exists content_pipeline_owner_idx
  on public.content_pipeline (owner_user_id);

create index if not exists content_pipeline_status_updated_idx
  on public.content_pipeline (status_updated_at desc);

-- Bump status_updated_at only when the status column actually changes
-- (not on every touch — that's what updated_at is for).
create or replace function public.tg_content_pipeline_status_changed()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    new.status_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists touch_content_pipeline_status on public.content_pipeline;
create trigger touch_content_pipeline_status
  before update on public.content_pipeline
  for each row execute function public.tg_content_pipeline_status_changed();
