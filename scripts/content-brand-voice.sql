-- Content Studio brand voice training schema

CREATE TABLE IF NOT EXISTS public.brand_voice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('brand', 'sample')),
  extracted_text text NOT NULL,
  text_excerpt text,
  text_length integer DEFAULT 0,
  uploaded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brand_voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tone jsonb DEFAULT '[]'::jsonb,
  style_preferences jsonb DEFAULT '[]'::jsonb,
  legal_terms jsonb DEFAULT '[]'::jsonb,
  common_phrases jsonb DEFAULT '[]'::jsonb,
  disclaimers jsonb DEFAULT '[]'::jsonb,
  messaging_patterns jsonb DEFAULT '[]'::jsonb,
  guidelines_summary text,
  source_document_count integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.brand_voice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_voice_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_voice_documents'
      AND policyname = 'Authenticated brand_voice_documents'
  ) THEN
    CREATE POLICY "Authenticated brand_voice_documents"
      ON public.brand_voice_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brand_voice_profiles'
      AND policyname = 'Authenticated brand_voice_profiles'
  ) THEN
    CREATE POLICY "Authenticated brand_voice_profiles"
      ON public.brand_voice_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
