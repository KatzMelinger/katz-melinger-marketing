-- =============================================================================
-- Form submissions (CallRail) — local mirror so web-form leads live alongside
-- calls and can be analyzed for lead-response leakage. Forms were previously
-- fetched live from CallRail and thrown away; this persists them.
--
-- Tables:
--   forms  — one row per CallRail form_submission id
--
-- Mirrors the public.calls conventions (tenant_id, RLS, updated_at trigger).
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.forms (
  id text PRIMARY KEY,                     -- CallRail form_submission id (string)
  form_name text,
  customer_name text,
  customer_phone_number text,
  customer_email text,
  source text,
  source_name text,
  submitted_at timestamptz,
  lead_status text,
  raw jsonb,                               -- full raw submission for future-proofing
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forms_submitted_at ON public.forms (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_forms_source_name ON public.forms (source_name);
CREATE INDEX IF NOT EXISTS idx_forms_tenant_id ON public.forms (tenant_id);
CREATE INDEX IF NOT EXISTS idx_forms_phone ON public.forms (customer_phone_number);

ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'forms'
                 AND policyname = 'Authenticated users have full access to forms') THEN
    CREATE POLICY "Authenticated users have full access to forms"
      ON public.forms FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Reuse the sales-coach updated_at trigger fn if present; else define a local one.
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_forms_updated') THEN
    CREATE TRIGGER trg_forms_updated BEFORE UPDATE ON public.forms
      FOR EACH ROW EXECUTE FUNCTION public.set_sales_coach_updated_at();
  END IF;
END $$;
