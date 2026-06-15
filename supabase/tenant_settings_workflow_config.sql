-- ============================================================================
-- Content Production board — PER-TENANT customization (SaaS)
-- ----------------------------------------------------------------------------
-- The board's columns and content-mix buckets are tenant-configurable so a
-- second firm can run its own workflow without a code change.
--
--   workflow_stages : the kanban columns. Each entry has a FIXED `kind` (the
--     capability the code branches on — opportunity|brief|draft|approve|published)
--     plus a tenant-chosen `label` and `order`. A firm may rename/reorder/drop
--     stages; the engine keys off `kind`, the UI renders label+order.
--
--   content_buckets : the content-mix tags (Money Page / BOFU / MOFU / Local...).
--     Pure classification, no behavior — fully free-form per tenant.
--
-- Defaults below ARE Katz Melinger's flow, so KM is unchanged and every new firm
-- starts with a sensible board out of the box (override later in Settings).
-- Idempotent.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists workflow_stages jsonb not null default
    '[
      {"kind":"opportunity","label":"Opportunity","order":1},
      {"kind":"brief","label":"Brief","order":2},
      {"kind":"draft","label":"Draft","order":3},
      {"kind":"approve","label":"Approve","order":4},
      {"kind":"published","label":"Published","order":5}
    ]'::jsonb,
  add column if not exists content_buckets jsonb not null default
    '[
      {"id":"money_page","label":"Money Page"},
      {"id":"bofu_education","label":"BOFU Education"},
      {"id":"mofu_trust","label":"MOFU Trust"},
      {"id":"local_authority","label":"Local Authority"}
    ]'::jsonb;
