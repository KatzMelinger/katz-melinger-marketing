-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Never store <script> in a draft body — Diana's Oct 6 2026 spec, Task 8.
--
-- 43fb024e carried its FAQPage JSON LD as a <script> block in the body; it was
-- moved to metadata.schema_jsonld by the Task 12 corrections script. This
-- trigger makes that the rule for every write, whichever route or script does
-- it: before a draft is inserted or updated, each <script>...</script> block is
-- removed from the body. A block holding valid JSON (schema markup) is kept in
-- metadata.schema_jsonld, the same shape the corrections script used (the raw
-- JSON text; a list of them when there is more than one). Anything else is
-- kept in metadata.removed_scripts for the record and never published.
--
-- Idempotent.
-- ============================================================================

begin;

create or replace function public.content_drafts_move_scripts()
returns trigger
language plpgsql
as $$
declare
  m        text[];
  inner_   text;
  schemas  jsonb := '[]'::jsonb;
  other    jsonb := '[]'::jsonb;
  existing jsonb;
begin
  if new.body is null or new.body !~* '<script' then
    return new;
  end if;

  -- One block at a time. The negative lookahead keeps a match inside its own
  -- block (Postgres sets one greediness per pattern, so .*? cannot be used).
  for m in
    select regexp_matches(new.body, '<script[^>]*>((?:[^<]|<(?!/script))*)</script>', 'gi')
  loop
    inner_ := btrim(m[1]);
    begin
      perform inner_::jsonb;
      schemas := schemas || to_jsonb(inner_);
    exception when others then
      if inner_ <> '' then other := other || to_jsonb(inner_); end if;
    end;
  end loop;

  new.body := regexp_replace(new.body, '<script[^>]*>(?:[^<]|<(?!/script))*</script>[ \t]*\n?', '', 'gi');
  -- A stray opening or closing tag on its own.
  new.body := regexp_replace(new.body, '</?script[^>]*>', '', 'gi');

  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  if jsonb_array_length(schemas) > 0 then
    existing := new.metadata -> 'schema_jsonld';
    if existing is null or existing = 'null'::jsonb then
      existing := '[]'::jsonb;
    elsif jsonb_typeof(existing) <> 'array' then
      existing := jsonb_build_array(existing);
    end if;
    existing := existing || schemas;
    new.metadata := new.metadata || jsonb_build_object(
      'schema_jsonld',
      case when jsonb_array_length(existing) = 1 then existing -> 0 else existing end
    );
  end if;
  if jsonb_array_length(other) > 0 then
    new.metadata := new.metadata || jsonb_build_object(
      'removed_scripts',
      coalesce(new.metadata -> 'removed_scripts', '[]'::jsonb) || other
    );
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_move_scripts on public.content_drafts;
create trigger content_drafts_move_scripts
  before insert or update of body on public.content_drafts
  for each row execute function public.content_drafts_move_scripts();

commit;
