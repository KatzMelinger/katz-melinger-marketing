# SEO Content Pipeline — Part 4 Backlog (deferred "build later")

Source: Diana's "System Status for Kenneth" walkthrough (2026-06-10) + follow-up.
Parts 1–3 (urgent fix, bugs, connections), one-click-at-approval, and the Part 2
"fix soon" items are **done** (see git history around 2026-06-11 and the working
notes). This file holds what was intentionally deferred so it isn't lost.

**Build order:** strictly after Parts 1–3 are solid in production. Within Part 4,
build top-to-bottom — the WordPress publish button is explicitly last.

---

## 1. Intelligence layer — keyword grouper
**What:** Group individual keywords into page-level decisions before they hit the
Decisions queue. Diana's example: ~290 raw keywords should collapse into ~31 page
decisions. `wrongful termination lawyer` + `wrongful termination lawyers` +
`wrongful termination attorney` → one page decision.
**Why it matters:** Today each keyword can become its own Decision/Brief, which is
how near-duplicate pages (and cannibalization) get created in the first place.
**Reference:** `KM_Kenneth_IntelligenceLayer_June_2026.docx`
**Likely touch points:** a clustering step feeding `/api/seo/suggestions`; the
Decisions UI (`app/content/decisions`); `lib/strategy-engine.ts`.

## 2. Intelligence layer — cannibalization check (pre-surface)
**What:** Before surfacing a keyword as a new Decision, check whether
katzmelinger.com already has a page covering it. If yes, route it to the Refresh
Queue instead of proposing a new page.
**Why it matters:** Prevents creating competing pages for terms the site already
ranks for. Complements the *generation-time* overlap check (`detectContentOverlap`
in `lib/content-overlap.ts`) that already enforces "link, don't redefine" — this is
the *earlier* gate at decision time.
**Reference:** `KM_Kenneth_IntelligenceLayer_June_2026.docx`
**Likely touch points:** site inventory (`lib/site-inventory.ts`, `site_pages`),
`app/content/refresh`, the suggestion-creation path.

## 3. QA checklist automation
**What:** When a pipeline item reaches QA (status `review`), automatically check:
meta description present; H1 contains the primary keyword; pillar link present;
word count meets the minimum. Surface pass/fail in the Publishing QA stage.
**Why it matters:** Makes QA a real gate instead of a manual eyeball. Much of this
already exists as *advisory* analysis on drafts (`/api/content/drafts/[id]/analyze`
— readability, AEO, SEO breakdown incl. headingStructure/keywordPlacement); the
work is wiring those signals into a hard QA checklist on the board.
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** `app/content/publishing-qa`, reuse the analysis pipeline.

## 4. Performance Tracker
**What:** Track ranking position over time per published URL, show what moved the
ranking, and feed insights back to Opportunities.
**Why it matters:** Closes the loop from published content back to strategy.
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** DataForSEO rank data (vendor migration already approved —
see memory `vendor-migration-and-agent-plan`), a new tracking table + cron, and
`app/seo/opportunities`.

## 5. WordPress publish button — BUILD LAST
**What:** One button sends an approved draft to WordPress via the REST API. Diana
clicks once.
**Why it matters:** Removes the final manual hand-off — the end of the
"approve → publish" vision.
**Do not build until 1–4 are complete and Parts 1–3 are stable in prod.**
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** new publish route (WP REST), reuses the published-URL →
`site_pages` ingest already wired in `app/api/content/drafts/[id]` PATCH.

---

## Smaller leftover cleanups (not Part 4, but parked here)
- **Duplicate approved suggestions:** two `abogado de despido injustificado` rows
  exist in `brief_suggestions` (status approved), predating the dedup guard. The
  guard blocks new dupes; these old ones need a manual delete if desired. The
  `content_pipeline` dupe was already removed via `scripts/dedupe-pipeline.ts`.
- **True one-click coverage:** new approvals are one-click-ready (cannibalization
  gate auto-confirmed on approval); existing approved briefs were already
  confirmed. `scripts/confirm-approved-cannibalization.ts` exists as an idempotent
  backstop.

---

## Diana follow-up direction (2026-06-11) — refinements + new asks

Captured from Diana's note; some refine the items above, some are new. Two
vendor decisions (★) must be settled before building.

### A. Opportunity Radar = broaden beyond SEMrush (refines item #1/#2)
Diana's framing: the Radar is "SEO overall opportunities" and should ALSO pull
**Google Trends** and **other sites people visit weekly for employment-law help**
(community/forum signals). **Reality:** the Radar (`app/seo/opportunities`,
`lib/seo-intelligence.ts`, `lib/opportunity-pipeline.ts`) is **SEMrush-only**
today (competitor gaps, missing targets, long-tail). No Google Trends. The
`app/social/trends` page is Claude reasoning, not a live Trends feed. There's a
`community` module (`lib/community-suggester.ts`) that could feed the "other
sites" signal. → Work: add Google Trends + community/forum source ingestion to
the Radar.

### B. ★ Keyword tracking vendor — SEMrush vs DataForSEO
Diana: "keyword tracking is okay, it should come from SEMrush — which is what it's
doing." **Reality matches her:** production routes call `lib/semrush.ts`.
BUT the approved vendor plan (memory `vendor-migration-and-agent-plan`) is
SEMRush→DataForSEO, and `lib/dataforseo.ts` is already built as a drop-in
replacement (not yet swapped in). **DECISION NEEDED:** finish the DataForSEO
migration, or keep SEMrush for tracking? Don't half-migrate.

### C. Content draft editor — make it visual (SEMrush-style), not raw markdown
Diana's main concrete ask: the draft comes back as raw **markdown**; she wants a
better visual editor like the **SEMrush** screenshots she sent. **Reality:** a
rendered markdown preview ALREADY exists in Content Studio (`app/content/page.tsx`
uses `marked` + `dangerouslySetInnerHTML`), but the **Drafts library**
(`app/content/drafts/page.tsx`, where the SEO pipeline drafts live) is a raw
`<textarea>` only. → Quick win: reuse the Content Studio rendering for a
live preview pane in Drafts. → Fuller: SEMrush-style editor with live SEO score
sidebar (reuse the existing `/analyze` signals). Pending Diana's screenshots for
the exact visual target.

### D. Social media calendar + scheduling (NEW; overlaps item #5 publish)
Diana: from one blog, create social posts AND **schedule** them like Metricool;
she's sending a spec doc. **Reality:** one-blog→9-format generation ALREADY
exists (`lib/content-multiformat.ts`, `app/content/batch`). Metricool is wired
read-only for analytics. **No scheduling/calendar and no publish integration
exist** (agent publish leg is a stub). **★ DECISION:** the approved plan replaces
Metricool with **Ayrshare** for publishing — build the calendar/scheduling on
Ayrshare (matching the Metricool UX Diana likes), not Metricool. Waiting on her
calendar spec doc + "other features" details.

---

## Related one-off scripts (all dry-run by default, `--apply` to write)
- `scripts/clean-existing-geo-keywords.ts` — strip non-NY/NJ keywords (applied).
- `scripts/dedupe-pipeline.ts` — remove duplicate board rows (applied).
- `scripts/confirm-approved-cannibalization.ts` — confirm cannibalization on
  approved briefs (no-op as of 2026-06-11; backstop).
- `scripts/verify-pipeline-link.ts` — read-only smoke test of the pipeline↔draft
  wiring.
