-- Readability remediation findings.
--
-- Adds per-sentence readability findings (over-long / passive / complex
-- sentences) to content_analyses so they surface as Apply items in the review
-- panel, exactly like aeo_findings / seo_findings. The analyzer degrades
-- gracefully if this column is missing (it drops the field and retries), so
-- running this migration is what turns the feature fully on.

alter table public.content_analyses
  add column if not exists readability_findings jsonb not null default '[]'::jsonb;

comment on column public.content_analyses.readability_findings is
  'Array of Apply-able readability findings (one per over-long/passive/complex sentence).';
