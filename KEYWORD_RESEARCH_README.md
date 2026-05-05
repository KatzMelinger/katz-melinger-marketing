# Keyword Research — MarketOS Port

This bundle ports the keyword research feature from the old Replit app to
the existing MarketOS Next.js app at `katz-melinger-marketing`. It contains:

- 3 AI-powered tabs (Discover / Expand / Competitor Gaps) — same prompts and
  output shape as the Replit version
- A new Tracked tab — the firm's monitored keywords with live rank data
  pulled from Semrush (the SE Ranking integration is gone)
- A new Brand Voice page — edit the firm context (name, geography, key
  messages, tone, audience personas) that gets injected into every AI prompt
- Three new Supabase tables: brand_voice_settings, brand_voice_avatars,
  seo_keywords

---

## Setup checklist

### 1. Run the SQL migration

Open the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project and paste
in the contents of `supabase/keyword_research_schema.sql`. It creates the
three tables, enables RLS, and seeds reasonable defaults so keyword research
works on day one before you touch the Brand Voice page.

### 2. Confirm env vars in Vercel

The MarketOS project should already have these — confirm before deploying:

- SUPABASE_URL=https://yijrpbdctzrgfpwdezqn.supabase.co
- SUPABASE_SERVICE_ROLE_KEY (from Supabase → Project Settings → API)
- SEMRUSH_API_KEY (existing — used by SEO Overview)
- ANTHROPIC_API_KEY (existing — used by Content Studio)

Nothing new is needed; SE Ranking is not used.

### 3. Install npm deps

If MarketOS doesn't already have these (it should), add them:

    pnpm add @anthropic-ai/sdk @supabase/supabase-js lucide-react

The page also uses your existing shadcn Card, Button, and Badge components
from `@/components/ui/*`. If your component path alias differs, adjust the
imports at the top of the two page files.

### 4. Wire into the navigation

Add two entries to whatever sidebar/nav component MarketOS uses:

    Keyword Research → /keyword-research
    Brand Voice      → /brand-voice

### 5. Deploy

    git add .
    git commit -m "feat(marketing): keyword research feature ported from replit"
    git push

Vercel will auto-deploy. First visit /brand-voice to confirm the firm
context loads; then /keyword-research and run a Discover query.

---

## What changed vs. the Replit version

**Frontend**
- Vite → Next.js App Router: added "use client", dropped `import.meta.env`,
  removed the Layout/PageHeader wrappers since MarketOS has its own layout
  shell. Same shadcn components, same lucide icons, same dark UI.
- Added a 4th tab — Tracked — and a Track button on every keyword in the
  other 3 tabs so suggestions can flow straight into monitoring.

**Backend**
- Express → Next.js route handlers under app/api/...
- Drizzle (@workspace/db) → Supabase via lib/supabase-server.ts (lazy init,
  same pattern that fixed the Vercel build error on the CMS — see commit
  26cd0d9).
- pino → console.error (matches the rest of MarketOS).
- Anthropic SDK initialized via shared lib/anthropic.ts.
- Model snapshot fixed: the original code referenced "claude-sonnet-4-6"
  which is not a valid public model ID. Now uses
  "claude-sonnet-4-5-20250929" — bump the constant in lib/anthropic.ts
  when upgrading.

**Ranking provider — SE Ranking → Semrush**
- lib/semrush.ts replaces the SE Ranking helper. Uses the domain_organic
  endpoint (CSV-parsed) for the firm's ranked keywords and phrase_kdi for
  difficulty scores. Function signatures match the original
  getDomainKeywords() so call sites stayed the same.
- The refresh endpoint pulls 1000 rows once per refresh (covers the firm's
  current ~3,595 keyword footprint for the keywords likely to rank).
  Bump display_limit in getDomainKeywords() if the firm grows past that.

**New: Brand Voice**
- The original code's getFirmContext() read from brandVoiceSettings and
  brandVoiceAvatars tables that didn't exist in MarketOS. Schema added,
  seeded with sensible defaults, and a UI page added so you can edit them
  without SQL. Future MarketOS features (content drafting, ad copy, review
  responses) can reuse the same tables — single source of truth for firm
  voice.

---

## Cost notes

- **Anthropic** — each Discover / Expand / Gaps call uses ~3-8K input tokens
  + up to 8K output tokens against Sonnet 4.5. Roughly $0.05-$0.15 per call.
- **Semrush** — domain_organic is 10 API units per row, phrase_kdi is 50
  units per phrase. A keyword refresh of 50 tracked keywords against a
  1000-row domain pull is ~10,000 units. The Semrush plan that already
  powers SEO Overview should handle this comfortably.
