-- ============================================================================
-- Multi-tenancy — Phase 4: tenant-scoped RLS for the misc-small tables.
-- All id-PK, so RLS flip only. Libs/routes stamp tenant_id and scope reads:
--   recommendation_items, brief_suggestions, internal_link_audits,
--   llms_txt_versions, practice_areas (session tenant via resolveTenantId);
--   wp_autopilot_tokens + wp_autopilot_recommendations (tenant from the bearer
--   token for plugin requests; resolveTenantId for dashboard management).
-- wp_autopilot_tokens.token_hash stays GLOBALLY unique (random tokens).
-- Idempotent.
-- ============================================================================
do $$
declare t text; p text;
begin
  foreach t in array array[
    'recommendation_items','brief_suggestions','internal_link_audits',
    'llms_txt_versions','practice_areas','wp_autopilot_tokens',
    'wp_autopilot_recommendations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies
             where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
