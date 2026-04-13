-- PracticeOS sales pipeline + content tables for MarketOS (run in Supabase SQL editor)
--
-- Pipeline:
-- CREATE TABLE IF NOT EXISTS prospects (id uuid default gen_random_uuid() primary key, firm_name text, contact_name text, email text, phone text, firm_size integer, current_tools text, stage text default 'Lead', estimated_mrr numeric, source text, trial_firm_id uuid, trial_started date, last_activity date, notes text, created_at timestamp default now());
-- CREATE TABLE IF NOT EXISTS sales_activities (id uuid default gen_random_uuid() primary key, prospect_id uuid references prospects(id), type text, notes text, next_followup date, staff_member text, created_at timestamp default now());

CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name text,
  contact_name text,
  email text,
  phone text,
  firm_size integer,
  current_tools text,
  stage text DEFAULT 'Lead',
  estimated_mrr numeric,
  source text,
  trial_firm_id uuid,
  trial_started date,
  last_activity date,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.prospects (id) ON DELETE CASCADE,
  type text,
  notes text,
  next_followup date,
  staff_member text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_activities_prospect_id ON public.sales_activities (prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospects_stage ON public.prospects (stage);
CREATE INDEX IF NOT EXISTS idx_prospects_created_at ON public.prospects (created_at DESC);

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated prospects"
  ON public.prospects FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated sales_activities"
  ON public.sales_activities FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Brand voice + saved content drafts
CREATE TABLE IF NOT EXISTS public.brand_voice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text,
  title text,
  body text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.brand_voice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated brand_voice"
  ON public.brand_voice FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated social_posts"
  ON public.social_posts FOR ALL TO authenticated USING (true) WITH CHECK (true);
