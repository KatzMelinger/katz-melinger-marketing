# Huraqan Design System v2 — Adoption Plan

**Status:** Plan-only (saved 2026-06-24). Not started.
**Source of truth doc:** `Huraqan_Design_System.html` (v2.0, dated June 23 2026, authored by Diana Rivas).
**Origin:** Diana's review request — adopt the design system, add reference-image upload to the
image generator, and require a heads-up before any change that alters system *behavior* (not just looks).

## Context

- "Huraqan" is the product-facing name for the MarketOS dashboard (Katz Melinger). The design doc and
  the "Huraqan premium" mockups describe a **target** look — a dark-navy command center — not the
  current build.
- The current app is a **light** theme. Adopting the design system is a real reskin, not a tweak.

## Coherence gaps (spec vs. current code)

| Spec | Current | File | Severity |
|------|---------|------|----------|
| Navy sidebar `#0D1F3C`, 200px | Light `bg-slate-50`, 232px | `components/marketing-sidebar.tsx` | Major (light→dark) |
| Brand blue `#116AB2` | `#185FA5` (`--brand`) | `app/globals.css` | Shade diff |
| Inter + Playfair fonts | Geist sans/mono | `app/layout.tsx` | Fonts not loaded |
| Page bg `#F8FAFC` | White `#ffffff` | `app/globals.css` | Minor |
| Fixed status hex (`#EF4444`/`#F59E0B`/`#10B981`) | Tailwind red/amber/emerald scales | `components/dashboard-ui.tsx` | Cosmetic |
| Greeting header ("Good morning, Diana") | Formal "Marketing Intelligence" | `app/page.tsx` | Easy |

**Productization tension:** the doc hardcodes "Huraqan" + KM's specific blue as the single source of
truth, but the app is built white-label — sidebar/brand color come from a per-tenant `--brand` variable
(`components/tenant-provider.tsx`, `tenant_settings.brand_primary_color`). Decision: implement the design
system as the **default theme**, but keep brand color a **token**, not a fixed hex, so it doesn't fight
productization.

## Work items

### A. Reference-image upload for the image generator (quick, isolated win, ~1–2 hrs)
- Infra already exists: `generateWithReferences()` in `lib/openai-images.ts` uses OpenAI's image-edits
  endpoint to anchor on uploaded reference images. It's just not wired into the carousel flow.
- Carousel generation currently calls `generateImages()` in `lib/carousel-render.ts` (gpt-image-1,
  prompt-only, no image input).
- Steps:
  1. Accept optional `referenceImageUrls`/uploads in
     `app/api/content-production/repurpose/carousel-images/route.ts`.
  2. Load them as `Uint8Array` buffers.
  3. In `lib/carousel-render.ts`, if references exist, call `generateWithReferences()` instead of
     `generateImages()`.
  4. Add an upload control in the carousel draft / repurpose UI before generation.

### B. Design-system reskin (staged, each stage its own reviewable change)
1. Fonts + color tokens (Inter/Playfair, fixed status hex, brand token kept).
2. Navy sidebar (#0D1F3C, 200px, active-state rules per doc).
3. Dashboard layout: greeting header, alert strip (new component), section separator labels,
   AI Recommendation card (new), AI Visibility Tracker card (new).

## Safeguard (Diana's request)
A reskin is visual-only and shouldn't change behavior IF done as a theming pass. Items touching shared
components (sidebar restructure, status-color swap) carry minor regression risk. Before any such change:
state plainly what changes and what could break, confirm first, and keep visual changes separate from
functional ones. Never alter system operation under cover of a "design update."

## Open questions
- Confirm with Diana: keep brand color as a token (white-label) vs. hardcode Huraqan blue?
- New components (alert strip, AI Recommendation card, AI Visibility Tracker) — need real data sources
  wired, or placeholder first?
