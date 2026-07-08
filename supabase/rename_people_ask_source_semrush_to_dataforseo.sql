-- ============================================================================
-- Rename people_ask_sources.source_type value 'semrush' → 'dataforseo'.
-- ============================================================================
-- The question-keyword connector was migrated off Semrush onto DataForSEO
-- (lib/research-sources.ts). The stored source_type enum value follows suit so
-- the label is provider-accurate everywhere. Mirrors the earlier provider-
-- neutral rename in tenant_settings_rename_seo_domain.sql.
--
-- Steps, all idempotent:
--   1. Drop the existing (unnamed/auto-named) source_type CHECK constraint.
--   2. Migrate existing rows 'semrush' → 'dataforseo'.
--   3. Re-add the CHECK constraint with the new allowed value set.
-- ============================================================================

do $$
declare
  con_name text;
begin
  -- 1. Drop whatever CHECK constraint currently governs source_type.
  select c.conname into con_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'people_ask_sources'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%source_type%';

  if con_name is not null then
    execute format('alter table public.people_ask_sources drop constraint %I', con_name);
  end if;

  -- 2. Migrate existing rows.
  update public.people_ask_sources
  set source_type = 'dataforseo'
  where source_type = 'semrush';

  -- 3. Re-add the constraint with the updated value set (if not already present).
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'people_ask_sources'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%source_type%'
  ) then
    alter table public.people_ask_sources
      add constraint people_ask_sources_source_type_check
      check (source_type in (
        'paa',
        'autocomplete',
        'dataforseo',
        'search_console',
        'reddit',
        'youtube',
        'avvo',
        'justia',
        'quora',
        'competitor',
        'manual'
      ));
  end if;
end $$;
