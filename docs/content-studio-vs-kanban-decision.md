# Decision: Content Studio pipeline vs. the Kanban (Production Board)

**Status:** Proposed — awaiting team sign-off
**Date:** 2026-06-17
**Owner:** Ken Katz
**Question that triggered this:** "Why does Content Studio have a pipeline/editorial view if the Kanban already handles approval and publishing?"

---

## 1. The problem in one sentence

The Content Studio **pipeline** view and the **Production Board** (Kanban) are two different screens rendering the **exact same data** — the `content_pipeline` table — which makes the content lifecycle feel duplicated and confusing.

## 2. What's actually true in the code today

| | Content Studio pipeline (`/content/pipeline`) | Production Board (`/content-production`) |
|---|---|---|
| Data source | `content_pipeline` | **Same** `content_pipeline` |
| Presentation | Table, 5 statuses (idea → brief → draft → review → published) | Kanban, maps the same statuses into 5 columns |
| Extra features | Bucket tags (Money Page / BOFU / MOFU / Local), owner assignment | Approve gate, "held for legal" counter, Optimize & Repurpose tabs |
| Draft review | `DraftDrawer` component | **Same** `DraftDrawer` component |

- Verified: both read `content_pipeline` — see `app/api/content-production/route.ts` (board) and `app/content/pipeline/page.tsx` (studio).
- The only genuine difference is the *wrapping* on the board (compliance counters, optimize/repurpose tabs). The core idea→draft→approve lifecycle is duplicated.
- There is **no separate "editorial calendar"** — "pipeline" and "editorial" are used interchangeably.

**Why both exist:** historical, not designed. The Studio table came first as an editorial planning tool; the Production Board was later built as the "unified" board but layered on top of the same table instead of replacing the Studio's lifecycle columns.

## 3. The target model (what we want)

Two clearly separated jobs, one home each:

- **Content Studio = creation / intake only.** Manual ideas: add a trendy keyword, a topic, a strong idea → build a brief → generate a draft (blog, social, podcast/video script). This is where humans *start* content from scratch.
- **Kanban (Production Board) = the single lifecycle board.** Everything — manual *and* automated — moves through review → approve → publish here. One place to see what's awaiting approval, what's held for legal, and what's ready to publish.

Automated SEO content follows: **Opportunity → (brief) → draft → score → approve → appears on Kanban as unpublished.** It should never need to pass through the Studio's lifecycle columns.

## 4. Proposed decision

1. **Strip the lifecycle out of Content Studio.** Remove the review/published columns from the Studio pipeline view. Keep it as: capture idea → build brief → generate draft (then it hands off).
2. **Make the Kanban the only approval/publish surface.** All sources (manual, Opportunities, Peggy) land here for review → approve → publish.
3. **No schema change required.** Both views already read `content_pipeline` and share `DraftDrawer`. This is a UI/role split, not a data migration.

## 5. Known gaps to close (separate from the split)

These are real capability gaps surfaced while answering the question — track them independently:

1. **No single-keyword vs. cluster recommendation.** The brief wizard takes one primary keyword + manually-added secondaries. Nothing tells the user "this is better as a cluster." *Does not exist yet.*
2. **Opportunity → brief is a manual click,** not auto-generated. Plumbing exists (`/api/seo/briefs` → `/api/content/km-draft`); the automatic trigger is missing.
3. **"Approved = unpublished" is only half-there.** After approval items sit in the **Approve** column as `approved` (awaiting publish) — there's no distinct "Ready to publish / Unpublished" column, which is the confusing part.
4. **Internal-link suggestions on drafts — unverified.** Scoring (SEO/AEO/CASH ≥75 gate) exists; an internal-link recommender was not confirmed to exist.

## 6. Where Peggy fits (she covers part of this — but only one step)

Peggy is the chat assistant at `/agent`. She is mostly **advisory** (reads keywords, opportunities, trends, recommendations) with **one action tool that touches this workflow**:

- **`create_content_draft`** — generates a draft in brand voice, runs the compliance gate, and inserts a row into `content_pipeline` + `content_drafts` with status `review` (or `needs_legal` if held). Notes are prefixed *"Created by Peggy (chat)."* It **never publishes** — it drops the draft into the Approve column for a human.

So Peggy covers **exactly one hop: topic → draft → sent for approval.** She does **not**:
- create Opportunities (`seo_opportunities`) — only reads them
- create briefs in `brief_suggestions`
- move/approve/publish pipeline items
- recommend single keyword vs. cluster, or suggest internal links

**Implication for this decision:** Peggy is a *third entry point* into the same Kanban Approve column (alongside manual Studio drafts and Opportunity-driven drafts). That reinforces the target model — the Kanban should be the **one** convergence point for all three sources. Peggy does **not** reduce the Studio-vs-Kanban duplication; she just confirms the Kanban should be the single approval surface.

## 7. Open question for the team

Do we agree the Studio should lose its lifecycle columns and become creation-only, with the Kanban as the single approve/publish board? If yes, the next step is to scope the UI changes (no DB migration needed).
