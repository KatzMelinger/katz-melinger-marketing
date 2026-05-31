-- =============================================================================
-- Manual marketing spend
--
-- The CMS endpoint /api/v1/marketing/spend-by-source returns nothing in this
-- deployment, so attribution ROI/CPA read 0. This table lets the team enter
-- spend per channel per month by hand; /api/cms/funnel-by-source merges it in
-- (manual entry wins when present for a source).
--
-- `source` should match the channel name used elsewhere (CallRail source_name /
-- funnel source), e.g. "Google Ads", "LSA", "Organic". `period_month` is the
-- first day of the month the spend applies to.
--
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.marketing_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  period_month date NOT NULL,                 -- first of month, e.g. 2026-05-01
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, period_month)
);

CREATE INDEX IF NOT EXISTS idx_marketing_spend_period ON public.marketing_spend (period_month);
CREATE INDEX IF NOT EXISTS idx_marketing_spend_source ON public.marketing_spend (source);

ALTER TABLE public.marketing_spend ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'marketing_spend'
                 AND policyname = 'Authenticated users have full access to marketing_spend') THEN
    CREATE POLICY "Authenticated users have full access to marketing_spend"
      ON public.marketing_spend FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
