-- =============================================================================
-- Lead recovery + trend snapshots — turns the lost-lead leakage view from
-- read-only into an actionable recovery workflow, and persists weekly metrics
-- so leakage can be tracked over time (the rest of the app is snapshot-only).
--
-- Tables:
--   lead_recovery            — one row per lost-lead phone, tracks follow-up
--                              status so missed callers can be worked & recovered
--   lead_response_snapshots  — weekly point-in-time leakage metrics for trend
--
-- Mirrors the calls/forms conventions (tenant_id, RLS, updated_at trigger).
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- lead_recovery ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  phone text NOT NULL,                     -- normalized last-10 digits (lead identity)
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'called_back', 'reached', 'dead')),
  assigned_to text,
  notes text,
  first_lost_at timestamptz,               -- first-contact time when surfaced
  last_action_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_lead_recovery_tenant_status ON public.lead_recovery (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_recovery_phone ON public.lead_recovery (tenant_id, phone);

ALTER TABLE public.lead_recovery ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lead_recovery'
                 AND policyname = 'Authenticated users have full access to lead_recovery') THEN
    CREATE POLICY "Authenticated users have full access to lead_recovery"
      ON public.lead_recovery FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- lead_response_snapshots ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_response_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  snapshot_date date NOT NULL,
  window_days int NOT NULL DEFAULT 30,
  total_leads int NOT NULL DEFAULT 0,
  leads_connected int NOT NULL DEFAULT 0,
  connect_rate_pct numeric(5, 1) NOT NULL DEFAULT 0,
  missed_first_contact int NOT NULL DEFAULT 0,
  recovered int NOT NULL DEFAULT 0,
  lost int NOT NULL DEFAULT 0,
  first_time_caller_lost int NOT NULL DEFAULT 0,
  after_hours_lost int NOT NULL DEFAULT 0,
  estimated_lost_value numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date, window_days)
);

CREATE INDEX IF NOT EXISTS idx_lead_snapshots_tenant_date
  ON public.lead_response_snapshots (tenant_id, snapshot_date DESC);

ALTER TABLE public.lead_response_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lead_response_snapshots'
                 AND policyname = 'Authenticated users have full access to lead_response_snapshots') THEN
    CREATE POLICY "Authenticated users have full access to lead_response_snapshots"
      ON public.lead_response_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- updated_at trigger (reuse sales-coach fn if present) -------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_sales_coach_updated_at') THEN
    CREATE OR REPLACE FUNCTION public.set_sales_coach_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END
    $fn$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_recovery_updated') THEN
    CREATE TRIGGER trg_lead_recovery_updated BEFORE UPDATE ON public.lead_recovery
      FOR EACH ROW EXECUTE FUNCTION public.set_sales_coach_updated_at();
  END IF;
END $$;
