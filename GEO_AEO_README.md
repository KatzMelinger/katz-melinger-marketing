# GEO/AEO + Alerts — setup & usage

This bundle adds the no-external-dependency tier of marketing features:

- **Answer Engine Optimization (AEO)** — runs every enabled buyer-intent
  prompt against every available LLM, parses each answer for brand mentions,
  source citations, and sentiment, then computes coverage / share-of-voice.
- **Marketing alerts inbox** — unified notifications when SEO ranks drop,
  AI mention status changes, sentiment turns negative, new citation domains
  appear, or cannibalization is detected.
- **llms.txt generator** — builds a curated llms.txt manifest from the firm's
  sitemap, ready to paste at `/llms.txt`.
- **Cannibalization detection** — flags keywords where 2+ URLs from the firm
  are ranking in the top 30, which splits link equity.
- **Internal linking audit** — graph-based crawl that surfaces orphans, thin
  pages, and link hubs.
- **Cross-channel content correlation** — joins SEO ranks against AEO
  citations to find pages that win at both, win at one, or are missing from
  the wrong column.
- **Claude-powered recommendations** — reads the firm's latest data and
  produces a prioritized action list.

## 1. Run the SQL migration

In the Supabase SQL editor for the `yijrpbdctzrgfpwdezqn` project, paste the
contents of `supabase/geo_alerts_schema.sql` and run it. It creates nine new
tables, enables RLS, and seeds:

- A `self` target row for Katz Melinger
- 10 starter buyer-intent prompts
- 6 default alert rules (rank drops, AEO gain/loss, sentiment shift, new
  citation, cannibalization)

Re-running the migration is safe — every statement is idempotent.

## 2. Environment variables

| Variable | Required | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | everything |
| `SEMRUSH_API_KEY` | yes | cannibalization, correlation, alerts |
| `ANTHROPIC_API_KEY` | yes | AEO Claude provider, recommendations |
| `OPENAI_API_KEY` | optional | AEO ChatGPT provider |
| `PERPLEXITY_API_KEY` | optional | AEO Perplexity provider |
| `GEMINI_API_KEY` | optional | AEO Gemini provider |

Day 1 the AEO sweep works against Claude only. Adding any of the optional
keys lights up that provider with no code change — the AEO page shows green
dots for connected providers and grey dots for disconnected ones.

## 3. Pages added (in nav)

- `/aeo` — Answer Engine Optimization dashboard (the centerpiece). Tabs:
  - **Overview** — coverage %, per-provider coverage, share-of-voice,
    sentiment, per-prompt outcomes
  - **Prompts** — manage which prompts to test
  - **Brands** — manage the firm's self-target plus competitors
  - **Sources** — top citation domains across the latest sweep
  - **Runs** — sweep history
- `/recommendations` — Claude reads everything and proposes prioritized actions
- `/alerts` — unified inbox + rule tuning
- `/correlation` — rank vs. AI-citation join
- `/llms-txt` — generate / version / copy

Plus inside `/seo`:
- `/seo/cannibalization`
- `/seo/internal-links`

## 4. How to use it

**First sweep:**
1. Go to `/aeo`. The starter prompts and self-target are seeded.
2. Click **Run sweep** (top right).
3. The page polls and refreshes when the run finishes.
4. Open the Sources tab to see what domains AI is pulling from.
5. Open `/recommendations` and click Generate for Claude's read on the
   results.

**Adding competitors to track:**
1. `/aeo` → Brands tab → fill in name, optional domain, comma-separated
   aliases. The next sweep will count their mentions for share-of-voice.

**Tuning alerts:**
1. `/alerts` → bottom of page → click On/Off to toggle a rule. Thresholds
   are JSON for now (e.g. rank-drop default is `{"min_drop": 5, "min_volume": 30}`).

## 5. What's intentionally NOT here

These need things outside our control:

- **Google Ads / Meta / LinkedIn / TikTok Ads metrics** — need API tokens +
  business verifications.
- **Google Search Console (CTR, indexation, crawl errors)** — needs OAuth.
  The marketing app already has a Search Console page using a service account;
  extending it for CTR/indexation is a separate task.
- **Core Web Vitals** — needs the PageSpeed Insights API key (free, just
  needs setup).
- **Social listening / sentiment / open-web mentions** — needs a paid
  service (Brand24 / Brandwatch / Mention).
- **NAP consistency, geo-grid local pack** — needs Yext / BrightLocal /
  Local Falcon subscriptions.
- **TikTok / YouTube Data / Pinterest / Reddit / Threads** — Metricool
  covers FB/IG/X/LinkedIn; the rest each need their own API setup.

## 6. Files added

```
supabase/
  geo_alerts_schema.sql          # one-shot migration

lib/
  aeo-providers.ts               # multi-LLM dispatcher (Claude/OpenAI/Perplexity/Gemini)
  aeo-analysis.ts                # parse responses for mentions, sentiment, sources
  aeo-runner.ts                  # orchestrate sweeps, persist responses
  alerts-engine.ts               # writeAlert + AEO/rank/cannibalization evaluators
  cannibalization.ts             # Semrush-driven detection + snapshot persistence
  internal-link-audit.ts         # site graph crawler
  llms-txt.ts                    # llms.txt manifest generator
  ai-recommendations.ts          # Claude-powered action list

app/
  aeo/page.tsx                   # dashboard with overview/prompts/brands/sources/runs
  alerts/page.tsx                # inbox + rule tuner
  correlation/page.tsx           # rank vs AI-citation joins
  llms-txt/page.tsx              # generator + version history
  recommendations/page.tsx       # Claude action list
  seo/cannibalization/page.tsx
  seo/internal-links/page.tsx
  api/aeo/                       # runs, prompts, targets, dashboard CRUD
  api/alerts/                    # list, ack, dismiss, evaluate, rules
  api/llms-txt/                  # generate, versions
  api/seo/cannibalization/       # scan, latest
  api/seo/internal-links/        # scan, latest
  api/recommendations/generate
  api/correlation/dashboard
```
