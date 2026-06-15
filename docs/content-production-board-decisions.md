# Content Production board — architecture decisions

**Date:** 2026-06-15
**Branch:** `feat/unified-content-board`

## What this is
A single unified **Content Production** board (`/content-production`) — 3 tabs
(New content / Optimize / Repurpose) over a per-tenant configurable kanban — that
gives Diana the "one board" her spec asked for, sitting **on top of** the team's
existing content-production engine (Opportunities radar, Production Board /
`content_pipeline`, the draft-drawer review flow, keyword-exclusions, auto-analyze).

It does **not** replace those screens or their data model — it's a unified front door.

## Decision: data source = read the existing tables directly (Option C)

The board assembles its view by reading the team's existing tables via the
RLS-scoped `getTenantDb()` — `seo_opportunities` (the "new content" funnel) +
`content_pipeline` (production stages) + `content_drafts` (artifacts). There is
**no `content_items` spine table**.

### Options considered
- **A — spine TABLE** (one row per item, backfilled/synced): cleanest unified
  model, matches the literal spec, but **dual-write drift** risk — a second schema
  to keep in sync, per tenant, alongside the team's actively-developed tables.
- **B — spine VIEW** (SQL view projecting the tables into one-row-per-item):
  same unified read shape, auto-synced, no dual-write — **but** a Postgres view
  defaults to the owner's rights; without `security_invoker = on` it can leak rows
  across tenants (a multi-tenant footgun).
- **C — API reads the tables directly** (chosen): lowest tenant-isolation risk
  (RLS enforced on every base-table query), no duplicate schema, fully reversible.
  Cost: dedup/assembly logic lives in app code rather than a clean single row.

### Why C
Picked for **SaaS safety + reversibility**: no cross-tenant view footgun, no
dual-write drift, and the team owns the underlying tables (a parallel spine would
fight their active model). The board UI + per-tenant `workflow_stages` config are
identical regardless of A/B/C, so this is an internal data-access detail.

## ⏳ REVISIT — promote to a spine later if it earns its keep
C is the safe starting point, **not necessarily the end state**. Revisit when:
- **Performance** — if assembling the board from multiple table reads gets slow at
  scale (many tenants / many rows), promote to **B (a `content_items` VIEW with
  `security_invoker = on`)** for a clean, indexed, auto-synced read model.
- **Ownership** — if/when this board becomes the *source of truth* for content
  (writes flow through it, not the legacy screens), promote to **A (a real
  `content_items` spine table)** — at which point the dual-write concern disappears
  because there's only one writer.

The earlier Option-C spine work (a `content_items` table + backfill) lives in git
history on the `content-production-reorg` branch if we ever want to resurrect it.
