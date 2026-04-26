-- =============================================================================
-- Sales Coach: CallRail call sync + AI-powered scoring against the firm's SOPs.
--
-- Tables:
--   calls                      — synced CallRail calls (one row per call_id),
--                                including transcript and voicemail flag
--   call_scores                — AI scoring results per call (one most-recent row)
--   sales_training_materials   — uploaded SOPs / playbooks / scripts
--   sales_rubric               — editable scoring rubric (seed lives in
--                                lib/sales-coach-rubric.ts; rows here win)
--
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- calls (CallRail mirror) ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calls (
  id text PRIMARY KEY,                     -- CallRail call id (string)
  customer_name text,
  customer_phone_number text,
  customer_city text,
  customer_state text,
  customer_country text,
  tracking_phone_number text,
  duration int,                            -- seconds
  answered boolean NOT NULL DEFAULT false,
  voicemail boolean NOT NULL DEFAULT false,
  direction text,                          -- inbound | outbound
  source_name text,
  start_time timestamptz,
  first_call boolean NOT NULL DEFAULT false,
  lead_status text,
  agent_email text,
  value numeric(12, 2),
  tags text[] DEFAULT '{}',
  note text,
  keywords text,
  recording_url text,
  recording_player_url text,
  recording_duration int,
  transcription text,                      -- CallRail-provided transcript
  transcription_language text,             -- en | es | mixed | unknown
  raw jsonb,                               -- full raw row for future-proofing
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_start_time ON public.calls (start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calls_answered ON public.calls (answered);
CREATE INDEX IF NOT EXISTS idx_calls_agent_email ON public.calls (agent_email);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calls'
                 AND policyname = 'Authenticated users have full access to calls') THEN
    CREATE POLICY "Authenticated users have full access to calls"
      ON public.calls FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- call_scores ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id text NOT NULL REFERENCES public.calls (id) ON DELETE CASCADE,
  rubric_type text NOT NULL                 -- intake | consultation | callback
    CHECK (rubric_type IN ('intake', 'consultation', 'callback', 'unclassified')),
  language text NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'es', 'mixed', 'unknown')),
  overall_score int,                        -- 0–100
  case_quality_estimate text                -- High | Medium | Low | N/A
    CHECK (case_quality_estimate IN ('High', 'Medium', 'Low', 'N/A') OR case_quality_estimate IS NULL),
  case_type_detected text,                  -- wage_and_hour | severance | discrimination | …
  dimension_scores jsonb NOT NULL DEFAULT '[]', -- [{dimension, score, max, evidence, missed, do_better}]
  objections_log jsonb NOT NULL DEFAULT '[]',   -- [{objection, response_used, alignment}]
  compliance_flags jsonb NOT NULL DEFAULT '[]', -- [{phrase, severity, location}]
  script_recommendations jsonb NOT NULL DEFAULT '[]', -- ["…"]
  summary_screener text,                    -- written in the call's language
  summary_manager text,                     -- always English
  model_id text,                            -- e.g. claude-sonnet-4-20250514
  prompt_version int NOT NULL DEFAULT 1,
  scored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_scores_call_id ON public.call_scores (call_id);
CREATE INDEX IF NOT EXISTS idx_call_scores_scored_at ON public.call_scores (scored_at DESC);

ALTER TABLE public.call_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'call_scores'
                 AND policyname = 'Authenticated users have full access to call_scores') THEN
    CREATE POLICY "Authenticated users have full access to call_scores"
      ON public.call_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- sales_training_materials -----------------------------------------------
-- Mirrors the brand_voice upload pattern. Documents that contribute context
-- to the AI scorer (intake scripts, playbook, fee policy, glossary, etc.).
CREATE TABLE IF NOT EXISTS public.sales_training_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  doc_type text NOT NULL DEFAULT 'sop'
    CHECK (doc_type IN ('sop', 'script', 'playbook', 'glossary', 'training', 'other')),
  section_code text,                        -- e.g. 5.2.3-a
  full_text text NOT NULL,
  summary text,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_sales_training_materials_active ON public.sales_training_materials (active);

ALTER TABLE public.sales_training_materials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_training_materials'
                 AND policyname = 'Authenticated users have full access to sales_training_materials') THEN
    CREATE POLICY "Authenticated users have full access to sales_training_materials"
      ON public.sales_training_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- sales_rubric (editable rubric overrides) -------------------------------
-- The default rubric is hardcoded in lib/sales-coach-rubric.ts (so the system
-- works on day one without seed data). Rows here override or extend the
-- defaults. Identified by (rubric_type, dimension_key).
CREATE TABLE IF NOT EXISTS public.sales_rubric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_type text NOT NULL
    CHECK (rubric_type IN ('intake', 'consultation', 'callback')),
  dimension_key text NOT NULL,              -- stable id e.g. "opening_introduction"
  dimension_name text NOT NULL,             -- human-readable
  max_score int NOT NULL DEFAULT 10,
  sort_order int NOT NULL DEFAULT 0,
  criteria_text text NOT NULL,              -- description / what to look for
  sop_reference text,                       -- e.g. "5.2.3-a §3.1"
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rubric_type, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_rubric_type ON public.sales_rubric (rubric_type);

ALTER TABLE public.sales_rubric ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_rubric'
                 AND policyname = 'Authenticated users have full access to sales_rubric') THEN
    CREATE POLICY "Authenticated users have full access to sales_rubric"
      ON public.sales_rubric FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- updated_at trigger -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_sales_coach_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_calls_updated') THEN
    CREATE TRIGGER trg_calls_updated BEFORE UPDATE ON public.calls
      FOR EACH ROW EXECUTE FUNCTION public.set_sales_coach_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_training_materials_updated') THEN
    CREATE TRIGGER trg_sales_training_materials_updated BEFORE UPDATE ON public.sales_training_materials
      FOR EACH ROW EXECUTE FUNCTION public.set_sales_coach_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_rubric_updated') THEN
    CREATE TRIGGER trg_sales_rubric_updated BEFORE UPDATE ON public.sales_rubric
      FOR EACH ROW EXECUTE FUNCTION public.set_sales_coach_updated_at();
  END IF;
END $$;
