# Huraqan Design System v2 — Adoption Plan

**Status:** In progress (updated 2026-07-08). Stage-B1 cosmetic pass + item-A
reference-image upload shipped; navy sidebar (B2) and new dashboard cards (B3)
not started.

**Done so far (2026-07-08):**
- Fonts: Inter (all UI) + Playfair Display (wordmark) loaded; Geist replaced. `app/layout.tsx`.
- Color tokens: full design-system palette (navy/status/surface) added to `:root`;
  brand default → `#116AB2`; page bg → `#F8FAFC`. `app/globals.css`.
  Brand accent resolved to `#116AB2` at runtime by fixing the `getTenantConfig`
  fallback (`lib/tenant-config.ts`, `#185FA5`→`#116AB2`) — KM's stored
  `brand_primary_color` is null, so this product-default fallback governs the
  `--brand` token (no per-tenant DB override written; white-label stays clean).
  Also updated the brand-accent fallbacks in `lib/carousel-render.ts` +
  the carousel-images route.
  Full `#185FA5` sweep DONE (37 code files): Tailwind arbitrary classes
  (`bg-[#185FA5]`, `hover:bg-[#1f6fb8]`, etc.) → `brand` token utilities
  (`bg-brand`, `hover:bg-brand/90`) so they're now per-tenant; all JS/CSS/HTML
  literals (`const ACCENT`, recharts stroke/fill, inline styles, PIE arrays,
  department accents, email HTML, onboarding default) hex-bumped `#185FA5`→`#116AB2`
  (kept as literal hex — safe in canvas/email/alpha-concat contexts, where
  `var(--brand)` would break). Diff is provably color-only; tsc clean; no new lint.
  Note: the hex-bumped literals are the new blue but NOT per-tenant (a page needing
  per-tenant charts would have to read `useTenant().brandColor`) — deferred.
- Greeting header: `components/dashboard-greeting.tsx` (time-of-day greeting + local
  date, effect-free via `useHydrated`) replaces the formal "Marketing Intelligence"
  title on `app/page.tsx`. No first-name source in auth yet → greeting omits the name
  (shows "Good evening" not "Good evening, Kenneth"); wiring a name is a small follow-up.
- Reference-image upload (item A): carousel flow now accepts optional brand reference
  images that anchor generated backgrounds via `generateWithReferences()`.
  UI upload (normalizes to PNG, ≤4, downscaled) in `components/repurpose-review-drawer.tsx`;
  decode in the carousel-images route; `referenceImages` plumbed through `renderCarouselSlides`.

---

_Original plan below._

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
1. ✅ Fonts + color tokens (Inter/Playfair, fixed status hex, brand token kept). DONE 2026-07-08.
2. ✅ Navy sidebar (#0D1F3C, 200px, active-state rules per doc). DONE 2026-07-08.
   - `components/marketing-sidebar.tsx` rewritten: navy #0D1F3C bg, 200px, brand logo square
     (APP_NAME initial or tenant logo), product+org name, colored section pills (dept.accent),
     nav hover #112240/#CBD5E1, active #1B3A6B + white + 3px `border-brand` left, bottom user
     row (26px avatar w/ email initials, email+role, sign-out).
   - DEVIATION (Kenneth-approved): kept whole-sidebar collapse (« / », defaults open) AND
     per-group collapse — the doc says no collapse, but we keep it defaulting open. Section
     pills stay clickable to toggle their group.
   - Status dots + badges WIRED 2026-07-08 (after B3): brand-block shows live connection dots for
     core integrations (WordPress/Semrush/Social) and Production Board carries a red approval-count
     badge, both from the shared `components/system-status.tsx` context (dedupes the alert strip's
     two fetches). Never-configured (`missing_env`) integrations are hidden so dots stay real signal.
   - Verified: tsc clean, eslint clean on the file, no server compile/runtime errors. NOT visually
     screenshotted — the preview env has no login session and the app gates all routes behind
     /login; view it in a logged-in browser to eyeball.
3. ✅ Dashboard layout (mostly): greeting header, alert strip, AI Recommendation card, AI Visibility
   Tracker — DONE 2026-07-08. (Section separator labels not needed with the card layout.)
   - **Alert strip** `components/alert-strip.tsx` — client, mounted in LayoutShell above all content.
     Real data only: integrations with status `error`/`needs_oauth` (from `/api/integrations/status`)
     + content `review` count (from `/api/content/pipeline`). Deliberately ignores `missing_env`/
     `needs_setup` (optional/never-configured integrations = noise). Renders NOTHING when clean (§6).
   - **AI Recommendation card** `components/ai-recommendation-card.tsx` — top 3 active items from
     `getPeggyRecommendations()` → `recommendation_items`. Items have no href, so link is derived from
     `category`; priority from `impact`. Honest empty state when none.
   - **AI Visibility Tracker** `components/ai-visibility-card.tsx` — per-engine Cited/Partial/Not found
     from `getAiVisibilitySnapshot()` → `/api/aeo/dashboard` `providerCoverage` + `providerStatus`.
     Engines w/o API key = "Not connected"; no run yet = "No data" + a "run one" link. `selfMentionRatePct`
     footer. Nothing fabricated.
   - Both cards fetched server-side in `app/page.tsx` Board (added to the Promise.all), rendered in a
     2-up grid under the greeting.
   - Critical-issues chip WIRED 2026-07-08: new `GET /api/ai-search/critical-count` returns just the
     count from the latest `ai_search_scans.analysis.criticalIssues` (real Claude-crawl data, NOT the
     mock `technical_seo_runs.crawl_errors`). Added to the shared `system-status` context → alert strip
     shows a red "N critical site issues" chip → /ai-search. Only shows when a scan exists with issues.
   - Verified: tsc clean, eslint clean (only a pre-existing `rightHeader` warning), no compile/runtime
     errors. NOT visually screenshotted (preview unauthenticated). What the cards show depends on real
     state: no active recs / no completed AEO run → honest empty states.
   - SIDEBAR follow-up now unblocked: the alert strip's integration-health + approvals data can feed the
     sidebar brand-block status dots + nav count badges that were omitted in B2.

## Safeguard (Diana's request)
A reskin is visual-only and shouldn't change behavior IF done as a theming pass. Items touching shared
components (sidebar restructure, status-color swap) carry minor regression risk. Before any such change:
state plainly what changes and what could break, confirm first, and keep visual changes separate from
functional ones. Never alter system operation under cover of a "design update."

## Open questions
- Confirm with Diana: keep brand color as a token (white-label) vs. hardcode Huraqan blue?
- New components (alert strip, AI Recommendation card, AI Visibility Tracker) — need real data sources
  wired, or placeholder first?
