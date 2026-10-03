-- =============================================================================
-- Intake & Sales dashboard: who owned each lead before it was signed.
--
-- Airtable overwrites "Legal Assistant # 1" and "Attorney/Reviewer" with the
-- matter's staff when a lead is signed ("Moved to Matters DB"). The hourly
-- snapshot cron (/api/sales-dashboard/snapshot) records both values for every
-- lead that is NOT yet signed, so after signing the last row still holds the
-- intake person and the sales reviewer who earned the credit.
--
-- Leads signed before the snapshot existed are credited by hand on the
-- dashboard's review page (source = 'manual'); the cron never overwrites those.
--
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.intake_staff_snapshots (
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
    REFERENCES public.tenants (id),
  airtable_id text NOT NULL,                -- Intake Form Data record id
  legal_assistant text,
  reviewer text,
  source text NOT NULL DEFAULT 'snapshot'
    CHECK (source IN ('snapshot', 'manual')),
  confirmed_by text,                        -- email of whoever set a manual row
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, airtable_id)
);

ALTER TABLE public.intake_staff_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'intake_staff_snapshots'
                 AND policyname = 'Authenticated users have full access to intake_staff_snapshots') THEN
    CREATE POLICY "Authenticated users have full access to intake_staff_snapshots"
      ON public.intake_staff_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
