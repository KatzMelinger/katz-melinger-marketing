# Content Readability Analysis — Implementation Plan

Status: proposed (not yet built)
Branch: `claude/content-readability-analysis-xkovxc`
Author decisions captured: storage extends `content_analyses`; in-editor highlighting via a rich-text/source editor; this plan written before any code.

---

## 1. Context — what already exists

About half of the source spec is already implemented. Build *on* it, not beside it.

| Capability | Where it lives today |
|---|---|
| Flesch reading ease + Flesch–Kincaid grade, syllable counter | `lib/content-analysis.ts:113-134` (homegrown, no library) |
| Readability persistence (`readability_score` 0–100, `reading_grade_level`, `word_count`, `sentence_count`) | table `content_analyses` (`supabase/content_studio_schema.sql`), 1:1 to `content_drafts` via `draft_id`, cascade delete |
| Auto-run on generation completion (no per-keystroke) | `lib/auto-analyze.ts` via Next `after()`, called from `km-draft`, `batches`, `draft`, `content-production/update-draft` routes |
| Re-run endpoint + panel UI | `app/api/content/drafts/[id]/analyze/route.ts`, `components/analysis-card.tsx` |
| Production Board | `app/content-production/page.tsx` (assembles from `content_pipeline` + `seo_opportunities`; opens `DraftDrawer`) |

Does **not** exist yet: long-sentence / long-paragraph detection, passive voice, transition words, consecutive sentence openers, subheading gaps, in-editor highlighting, and any analysis trigger on manual **Save**.

Two editing surfaces share the work and both must be considered:
- `components/draft-drawer.tsx` — opened from the Production Board.
- `app/content/drafts/page.tsx` — the saved-drafts library.
Both edit Markdown in a `font-mono <textarea>`, render preview via `marked`, and render the shared `AnalysisCard`.

---

## 2. Decisions locked

1. **Storage:** extend `content_analyses`. Do **not** add `readability_*` columns to `content_drafts` (would duplicate `readability_score` / `reading_grade_level` / `word_count` / `sentence_count` already there and create two sources of truth).
2. **Highlighting:** replace the Markdown `<textarea>` with a source editor that supports range decorations. Recommended: **CodeMirror 6** (see §6 for rationale vs WYSIWYG).
3. **Trigger:** run on generation completion (already wired) **and** on manual Save (not wired — added in Phase 1).

---

## 3. Phase 0 — Foundation (do first; cheap now, expensive to retrofit)

### 3.1 Schema migration — `supabase/content_analyses_readability.sql`
Idempotent `alter table ... add column if not exists` on `public.content_analyses`:

```
readability_avg_sentence_length   numeric
readability_long_sentences_count  integer
readability_long_paragraphs_count integer
readability_passive_voice_pct     numeric
readability_transition_word_pct   numeric
readability_overall_status        text   -- 'green' | 'amber' | 'red'
readability_consecutive_openers   integer
readability_subheading_gap_count  integer
```
Notes:
- `flesch_score` / `grade_level` / `avg_sentence_length` reuse existing `readability_score` (normalized) + `reading_grade_level`. Add a raw `readability_flesch_raw numeric` only if the raw (un-normalized) Flesch value must be surfaced.
- `readability_checked_at` = existing `content_analyses.created_at` (a new row is written each analysis run). No new column needed.
- Follow the file header convention in sibling migrations (DB-target check block).

### 3.2 Shared Markdown→plaintext helper — `lib/readability/plaintext.ts`
Strips headings, list markers, link/image syntax, code fences, emphasis. Returns `{ text, sentences[], paragraphs[], headings[] }` with source offsets so the editor can map a flagged sentence back to a character range. **This also fixes a latent bug:** `basicMetrics()` currently runs Flesch on raw Markdown, inflating counts. Route the existing metric through this helper too.

### 3.3 Thresholds + status rollup — `lib/readability/config.ts`
Proposed defaults (tune for legal tone in review — formal legal writing is inherently more passive/longer, so general-web/Yoast cutoffs will over-flag):

| Metric | green | amber | red |
|---|---|---|---|
| Long sentence | < 20 words | 20–25 | > 25 |
| Long paragraph | < 120 words | 120–160 | > 160 |
| Passive voice % | < 10% | 10–15% | > 15% |
| Transition word % | > 30% | 20–30% | < 20% |
| Consecutive openers (same word ≥3 in a row) | 0 | 1 | ≥2 |
| Subheading gap (words between H2/H3) | < 300 | 300–350 | > 350 |
| FK grade level | ≤ 9 | 9–12 | > 12 |

`overall_status` = **worst-of** the per-metric statuses (one red ⇒ red). Simple, predictable, explainable to Diana.

---

## 4. Phase 1 — Priority 1 vertical slice (sentence + paragraph length)

Build this one check end-to-end before touching Priorities 2–5, because it forces the editor-highlighting pattern that everything else reuses.

1. **Compute** in `lib/readability/checks.ts`: `longSentences()`, `longParagraphs()`, `avgSentenceLength()` — pure functions over the §3.2 output, returning flagged ranges `{ start, end, words, severity }`.
2. **Persist:** extend the `ContentAnalysis` type + the write in `lib/content-analysis.ts` (`analyzeDraft`) to include the new fields and `overall_status`.
3. **Save trigger:** add `scheduleDraftAnalysis(...)` to `PATCH /api/content/drafts/[id]` (`app/api/content/drafts/[id]/route.ts`) when `body` changes — the missing "run on Save" half.
4. **Panel:** add a Readability section to `components/analysis-card.tsx` showing avg sentence length, long-sentence / long-paragraph counts, the green/amber/red chip, and a clickable list of flagged sentences (click → scroll/select the range in the editor).
5. **Editor highlighting:** introduce `components/markdown-editor.tsx` (CodeMirror 6) with a decoration extension fed by the flagged ranges. Swap it into **both** `draft-drawer.tsx` and `app/content/drafts/page.tsx` behind the same component so the two surfaces stay identical (they already share `PROSE_CLASS` for this reason).

Exit criteria: edit a draft, Save, see long sentences/paragraphs highlighted inline and listed in the panel with a status chip, persisted across reload.

---

## 5. Phases 2–6 (reuse the Phase 1 rails)

- **Phase 2 — Flesch (spec Priority 2):** mostly done. Surface raw FK grade + color-code in the new panel section; link grade flags to the longest sentences. Decide explicitly: keep homegrown calc **or** adopt one npm lib (`text-readability`) — not both. (Spec's "pip" is wrong stack; this is TS/Next.)
- **Phase 3 — Passive voice + AI rewrite (Priority 3):** detection in `lib/readability/checks.ts` first. Rewrite reuses the existing `apply-suggestion` route pattern + `ApplySuggestionModal` and `lib/anthropic.ts` model constants. Batch flagged sentences into one Claude call (not one call per sentence). Use the spec's prompt verbatim (keeps legal accuracy/length).
- **Phase 4 — Transition words (Priority 4):** word list in `lib/readability/config.ts`; percentage of sentences opening with a transition.
- **Phase 5 — Consecutive openers + subheading gap (Priority 5):** pure logic over §3.2 output.
- **Phase 6 — Production Board surfacing (Priority 6):** add `readability_overall_status` to the `/api/content-production` card payload (join analysis → draft → pipeline card) and render the chip on cards in `app/content-production/page.tsx`. No new denormalization — read the latest `content_analyses` row.

---

## 6. Editor choice — rationale

The body is stored and round-tripped as **Markdown**. A true WYSIWYG (TipTap/Lexical) maintains a document model and must serialize back to Markdown on every save — risking fidelity loss in a corpus that downstream code (`marked` preview, `.docx` export, compliance scan) assumes is faithful Markdown.

**CodeMirror 6** edits the Markdown *source* directly (no round-trip), and its decoration API is purpose-built for highlighting arbitrary character ranges — exactly the sentence/paragraph highlighting this feature needs. React 19 / Next 16 compatible. This is the lowest-risk way to satisfy the "rich-text editor with inline highlighting" decision without destabilizing the Markdown contract. If full WYSIWYG is later desired for non-readability reasons, that's a separate, larger effort.

---

## 7. Risks / open questions

- **Legal-tone calibration:** thresholds in §3.3 are general-web defaults; review against real KM drafts before shipping or Diana sees a wall of red.
- **Two editors, one component:** must swap both surfaces together to avoid divergence.
- **Markdown 16.2.3 / modified Next:** per `AGENTS.md`, read `node_modules/next/dist/docs/` before editing route handlers (`after()`, runtime, params-as-Promise already in use).
- **Performance:** checks are synchronous pure functions over plaintext — cheap; keep them out of the request path and inside `after()` like the existing analysis.

---

## 8. Sequence summary

Phase 0 (schema + plaintext helper + thresholds) → Phase 1 (Priority 1 end-to-end incl. Save trigger + CM6 highlighting) → Phases 2–5 (remaining checks on the same rails) → Phase 6 (board chips). Storage/threshold decisions move to the **front**, not the spec's Priority 6, because every check depends on them.
