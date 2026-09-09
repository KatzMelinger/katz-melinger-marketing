# Diana's Website Content + Social Media audit — status & plan

Source: Diana's audit email, received 2026-07-05, covering Website Content (7 items)
and Social Media (2 items). This tracks what was verified, fixed, and what's still open.

## Fixed (2026-07-05)

| Item | What was wrong | What changed | Files |
|------|----------------|--------------|-------|
| 1.3 Content Studio standalone save | `PATCH` save silently ignored failures (`res.json()` used without checking `res.ok`) — a real save failure looked identical to success. Not confirmed as an intentional May fix; likely still intermittent. | Added `res.ok` check + inline error message; error clears when switching drafts. | `app/content/drafts/page.tsx` |
| Em dash / en dash slipping through | The "no em dashes" rule was prompt text only ("no exceptions") — models don't reliably comply. One slipped through on the "civil litigation lawyer nyc" draft. | Added `stripBannedDashes()`, a deterministic post-generation filter (not a prompt instruction). Clause-break dashes become commas; numeric/statute ranges (`2020–2024`, `§5222–5240`) become hyphens so they still read correctly. Wired into all 3 generation paths. | `lib/anti-ai-voice.ts`, `app/api/content/km-draft/route.ts`, `lib/content-multiformat.ts`, `app/api/content/draft/route.ts` |
| 2.1 Content Calendar entries not clickable | Calendar chips were static display elements — no click handler at all. | Chips with a linked draft (`sourceDraftId`) now link to `/content/drafts?id=<id>`, opening the (now fixed) drafts editor. Chips with no linked draft keep prior behavior (external link to the live post, or static). | `app/social/content-calendar/page.tsx` |
| 1.1 SEO metadata not auto-generating | Root cause was narrower than assumed: the 5-step brief wizard already auto-drafts meta title/description and carries the pillar selection through. The real gap was every *other* generation path (autonomous agent pipeline, batch/Content Studio, social/email endpoints) — all routed through `generateMultiFormat()` — which never generated or saved meta title/description/URL slug/pillar link at all. This is almost certainly the source of the blank-metadata draft Diana flagged. | Blog-format generation now also produces meta title (50-60 chars), meta description (140-155 chars), and URL slug in the same generation call. Pillar + practice area auto-inferred from the topic via the existing `inferPillar`/`inferPracticeArea` matcher (same one the brief wizard uses) — an unmatched pillar stays blank for human review rather than being guessed. | `lib/content-multiformat.ts` |
| 1.7 Brand voice on sensitive topics | Brand voice was a uniform prompt per practice area (Employment vs. Collections) with zero topic-sensitivity detection — harassment/retaliation/termination content got the same treatment as routine wage-theft content. | Added a keyword + pillar-based sensitive-topic detector (harassment, retaliation, discrimination, wrongful termination, "fired," "pushed out," etc.). When matched, a high-priority tone override is prepended to the prompt: lead with calm/human/supportive language before any legal reference, never open with a legal-encyclopedia tone, keep the CTA supportive not transactional. Wired into all 3 generation paths. | `lib/anti-ai-voice.ts`, `app/api/content/km-draft/route.ts`, `lib/content-multiformat.ts`, `app/api/content/draft/route.ts` |

All changes type-checked clean (`tsc --noEmit`). The dash-stripping regex and the
sensitive-topic detector were both unit-tested against real edge cases before shipping.
UI-facing changes (calendar click, save-error banner) were not click-tested in a live
browser session — local dev requires login credentials that weren't available in this
session. Recommend a quick manual click-through before considering 1.3/2.1 fully closed.

## Answered directly (status-check items, no build needed)

| Item | Answer |
|------|--------|
| 1.2 Readability score | Single Flesch Reading Ease score (0-100), computed in `lib/content-analysis.ts`. No breakdown into sentence/paragraph length, passive voice, or Yoast-style checks. Does **not** block Approve — informational only. No passive-voice auto-fix flow exists. Only worth building the 5-check breakdown if Diana still wants it now that she knows what today's score actually is. |
| 1.6 Overlap vs. Cannibalization | Two unrelated systems. Content Overlap (`lib/content-overlap.ts`) checks a draft against the **live site only**, manual button-click only, "link don't redefine." Cannibalization (`lib/cannibalization.ts`) checks the firm's ranked keywords (Semrush) for multiple URLs competing for the same term, also manual/on-demand. **Neither compares a draft against other drafts still in the pipeline** — that's a separate existing tool (`lib/content-dedup.ts`), relevant to 1.4 below. |

## Not started — needs a decision, not just code

| Item | What's actually there today | Recommendation |
|------|------------------------------|-----------------|
| 1.5 Redraft/Optimize six-stage flow | Confirmed stub — explicit code comment: *"Optimize/Repurpose remain read-only placeholders until the Stage-6 wiring."* No Redraft button, no structure detection, no gap audit, no preview/approve-to-WordPress-at-same-URL. A separate, simpler "Repurpose" tab exists with a basic "Generate update draft" button. This is new construction, not a wiring fix — likely multi-week. | Scope/timeline conversation with Diana before committing to the full spec. |
| 2.2 Dedicated social generator | Social and blog share the same generation function/prompt (`generateMultiFormat`), differing only by model tier (Haiku vs. Sonnet) and unenforced prompt-text length guidance. However: **no carousel/multi-slide generation code exists anywhere in the app** — Instagram output is spec'd as a single caption, not slides. | Track down where the 8-slide carousel actually came from before greenlighting Diana's full rebuild spec — the scope may differ from what her email assumes. |
| 1.4 Backlog cleanup (new vs. update flag) | Not a build ask per Diana, but blocks distinguishing "new content" from "update existing page" drafts. Existing `content-dedup.ts` registry (semantic keyword matching) already blocks true duplicates and should do most of the triage work for free. | Decide whether a "new vs. update" flag is worth adding to the draft schema; leverage existing dedup tooling first rather than a fully manual pass. |
| Manual-post edit path | Calendar posts with no linked draft (announcements, manual posts) have nothing to open — no draft record backs them in the current data model. | Low priority; only build if Diana specifically asks. |
| Auto-generated blog `searchIntent` | Now defaults to "informational" for auto-generated metadata (not reliably inferable from a bare topic string). | Flag to Diana; the brief wizard already lets her set intent explicitly when she uses that flow. |

## Next step
Either 1.5 or 2.2 scoping conversation with Diana — both are real builds, not fixes.
