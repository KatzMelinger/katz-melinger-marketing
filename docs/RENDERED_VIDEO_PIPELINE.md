# Rendered Video Pipeline — Design / Scoping Doc

Status: **Proposal** (not built)
Author: drafted for Kenneth Katz / MarketOS
Last updated: 2026-06-02

---

## 1. What this is (and isn't)

This doc scopes turning a **video script** (already supported — see below) into an
**actual rendered video file** the firm can post.

It is deliberately separate from the script feature because the two have nothing
in common architecturally:

| | Video **scripts** | Rendered **video** |
|---|---|---|
| Output | Markdown text | Binary `.mp4` |
| Latency | ~5-15s (synchronous) | 1-10 **minutes** (async) |
| Storage | `content_drafts.body` (text) | object storage (S3 / Supabase Storage) |
| Cost | fractions of a cent | $0.10-$2.00+ per clip, external vendor |
| Failure modes | bad copy | render failure, moderation, quota, timeout |

**Scripts already ship.** As of this change, the batch generator produces
`video_short` (Reels/TikTok/Shorts shot lists) and `video_long` (YouTube
scripts) alongside blog/social/email. Those are pure text and flow through the
existing `content_drafts` pipeline. This doc is only about the *next* step:
producing a watchable file.

---

## 2. Why it's a real project, not a config change

The current content system is **text-only**:

- `content_drafts.body` is Markdown. There is no media/binary column.
- Every generation endpoint (`/api/content/draft`, `/api/content/batches`) is
  **synchronous** — it calls Claude, gets text back in seconds, autosaves, and
  returns in one request.
- `content_sources` handles file *uploads* (for repurposing into text), but
  nothing stores generated *media output*.

Rendered video breaks all three assumptions: it needs binary storage, an async
job model (renders take minutes), and a third-party render vendor with real
per-clip cost and moderation/quota failure modes.

---

## 3. Approach options

Pick a generation strategy first — it drives everything downstream.

### Option A — AI avatar / "talking head" (recommended first)
Vendors: **HeyGen**, **Synthesia**, **D-ID**.
Feed the `video_long` / `video_short` script → an avatar presenter reads it.

- ✅ Best fit for a law firm: explainer / "know your rights" content, a
  consistent on-brand presenter, no filming.
- ✅ Highest script reuse — the scripts we now generate are the direct input.
- ⚠️ Avatar realism / "uncanny" risk; per-seat + per-minute pricing.
- ⚖️ Compliance: a synthetic presenter discussing legal topics needs the same
  "not legal advice / consult an attorney" disclaimer baked into the script and
  ideally on-screen.

### Option B — Text/script-to-video with stock B-roll
Vendors: **Pictory**, **InVideo AI**, **Runway**, **Captions.ai**.
Script → auto-matched stock footage + AI voiceover + captions.

- ✅ Cheap, fast, good for social shorts.
- ⚠️ Generic stock look; less brand control; weaker for authority content.

### Option C — Voiceover only (audio-first)
Vendors: **ElevenLabs** (TTS).
Render the `podcast` / `video` script to an MP3, pair with a static card or
slides later.

- ✅ Cheapest, simplest, lowest risk — a good **Phase 0** to prove the async
  job + storage plumbing before committing to full video.
- ⚠️ Not actually video.

**Recommendation:** build the async + storage plumbing once (Phase 1), prove it
with **Option C (ElevenLabs voiceover)** as the cheapest real renderer, then add
**Option A (HeyGen avatar)** as the flagship. Both reuse the same job table and
storage; only the "renderer adapter" differs.

---

## 4. Architecture

### 4.1 New: async job model
Renders take minutes, so we cannot hold an HTTP request open. Introduce a job
record + polling (or webhook) pattern.

New table `video_renders`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `draft_id` | uuid fk → content_drafts | the source script |
| `provider` | text | `heygen` \| `elevenlabs` \| `pictory` … |
| `provider_job_id` | text | vendor's async job handle |
| `status` | text | `queued` \| `rendering` \| `succeeded` \| `failed` |
| `options` | jsonb | voice id, avatar id, aspect ratio, captions on/off |
| `output_url` | text | storage URL once `succeeded` |
| `duration_seconds` | numeric | |
| `cost_cents` | integer | for the cost ledger (see §6) |
| `error` | text | vendor error on failure |
| `created_at` / `updated_at` | timestamptz | |

### 4.2 New: object storage
Use **Supabase Storage** (already in the stack — least new infra) with a
private `video-renders` bucket and signed URLs for playback/download. S3 is the
alternative if volume grows.

### 4.3 New endpoints
- `POST /api/content/video/render` — body `{ draft_id, provider, options }`.
  Validates the draft is a `video_*` format, calls the vendor's "create job"
  API, inserts a `video_renders` row with `status: queued`, returns the
  `render_id` immediately. **Does not block.**
- `GET /api/content/video/render/[id]` — returns current status + `output_url`
  when ready. The UI polls this.
- `POST /api/content/video/webhook/[provider]` — preferred over polling where
  the vendor supports webhooks; flips status and stores `output_url`.

### 4.4 Status progression
`queued → rendering → succeeded` (or `→ failed`). A scheduled reconciler (the
repo already runs cron-style sweeps for SEO) sweeps stuck `rendering` jobs and
re-queries the vendor so a missed webhook doesn't strand a job forever.

### 4.5 UI
On a `video_*` draft in `/content/drafts`: a **"Render video"** button →
options modal (provider, voice/avatar, aspect ratio, captions) → shows a
progress card that polls `GET …/[id]` → on success, an inline player +
download + "mark approved". Keep it on the existing draft detail surface; no new
top-level nav needed for v1.

---

## 5. Data flow

```
Script draft (video_short / video_long, already exists)
   │  user clicks "Render video"
   ▼
POST /api/content/video/render   ──►  vendor create-job API
   │  insert video_renders {status: queued}
   ▼
returns render_id immediately (no blocking)
   │
   ├─ vendor webhook  ─►  POST /api/.../webhook  ─┐
   └─ or UI polls GET /api/.../[id] ──────────────┤
                                                   ▼
                          download finished file → Supabase Storage
                          update video_renders {status: succeeded, output_url, cost_cents}
                                                   │
                                                   ▼
                              UI shows player + download + approve
```

---

## 6. Cost, compliance, risk

- **Per-clip cost is real.** Record `cost_cents` on every render and surface a
  running total. Add a simple monthly cap / confirmation step before kicking off
  renders so a batch of YouTube videos can't quietly run up a bill.
- **Vendor quotas & rate limits** — handle `429`/quota errors as a normal
  `failed` state with a retry affordance, not a crash.
- **Legal/ethics compliance** — synthetic-presenter video on legal topics must
  carry the firm's standard disclaimer (no attorney-client relationship, not
  legal advice, prior results don't guarantee outcomes). Bake it into the script
  generation prompt for `video_*` *and* require an on-screen disclaimer overlay.
  This is the highest-risk item — confirm with the firm's own compliance stance
  before publishing any AI-presenter video.
- **Moderation** — vendors can reject content; treat as `failed` with the
  vendor's reason shown.

---

## 7. Phasing

| Phase | Scope | Rough effort |
|---|---|---|
| **0 — Scripts** | ✅ Done. `video_short` / `video_long` in the batch generator. | shipped |
| **1 — Plumbing (adapter scaffold)** | ✅ Done. `video_renders` table + storage bucket, async render/status/providers endpoints, swappable provider adapter, `stub` provider. Runnable today with zero credentials. UI render panel still to do. | shipped |
| **1b — First real vendor** | Implement one adapter (ElevenLabs voiceover or HeyGen avatar) against the interface + drop in the API key. | ~1-2 days/vendor |
| **2 — Avatar video + UI** | HeyGen/Synthesia adapter, render panel on the draft page (provider/voice/avatar/aspect picker + player), webhook handler, cost ledger + cap. | ~4-6 days |
| **3 — Polish** | Stuck-job reconciler, captions/branding overlay, publish-to-channel hooks, per-client provider config (for MarketOS productization). | ~1 week+ |
| **4 — No-account rendered video** (see §9) | Local `rendered` ffmpeg provider on a render worker: branded motion cards + slideshow/music clips built from the image-template system. Zero vendor account, zero per-clip cost. | ~2-4 days |
| **5 — Narrated explainer** (see §9.3) | Script shot-list → TTS voiceover → per-scene visuals → captions → ffmpeg assembly + disclaimer overlay. The highest-value format. | ~1.5-2.5 weeks |
| **6 — Usage-API render tier** (see §9.2) | `fal` (Veo/Kling/Sora aggregator) + `heygen` adapters billed per-use through the existing per-tenant usage meter — the DataForSEO/Ayrshare resale model. | ~1-2 days/adapter |

---

## 9. Future direction — no-account rendering, narrated explainer, usage-API resale

Added 2026-06-17. Context: the app is a white-label SaaS resold to law firms
(see `white-label-saas-roadmap.md`). The goal here is video creation that does
**not** force every tenant to sign up for a third-party design/video SaaS. There
are three economic tiers; build them in this order.

### 9.1 Tier A — no-account, code-rendered (recommended first)

Render video **from code with ffmpeg**, reusing the branded **image-template
system** (see the image-templates scope — `next/og` `ImageResponse` → branded
PNG frames) as the source frames. ffmpeg ships via an npm package
(`ffmpeg-static` / `@ffmpeg-installer/ffmpeg`) — **no account, just a bundled
binary.** Plugs in as a new local `VideoProvider` (`id: "rendered"`) so it
inherits the whole job table / storage / endpoints / UI unchanged; only the
adapter is new.

Outputs achievable with **zero third-party account**:
- **Animated branded cards** (silent / captioned) — a single option-2 template
  animated to 9:16 / 1:1 mp4 (text reveals, logo bumper).
- **Slideshow clips with a music bed** — several branded frames sequenced with
  Ken Burns pan/zoom, crossfades, and a **self-hosted royalty-free** track.

Not achievable without bringing in a vendor: talking-head avatars, AI voice
narration, photorealistic generated footage.

**Hosting:** ffmpeg needs a long-running Node runtime (CPU + temp disk +
minutes). Run renders in a **separate always-on render worker** (VM / container
— Render/Railway/Fly), pulling `queued` `video_renders` rows, rendering, writing
back. Keep the Next web tier where it is; do **not** put ffmpeg on serverless.

### 9.2 Tier B — usage-API render (the DataForSEO/Ayrshare resale model)

For real AI footage / avatars without per-tenant subscriptions, use **usage-
priced APIs** you hold one account for and meter per tenant through the existing
`recordVendorUsage` meter (same mechanism as DataForSEO Ads Transparency):

- **fal.ai** — the aggregator (one key → Veo 3.1 ~$0.10-0.20/s, Kling 3.0 Pro
  ~$0.11/s, Kling 2.5 Turbo ~$0.07/s, Sora 2). Pay-per-second, no subscription,
  SOC 2, JS SDK. **Wire this first** — one adapter unlocks several models.
- **Replicate** — same shape, ~$0.07-0.25/s, better docs, slightly pricier.
- **HeyGen** — pay-as-you-go avatar API, ~$1/min 720p/1080p, $5 min, no
  subscription (free API credits ended Feb 2026). For talking-head explainers.

Each is one `VideoProvider` adapter (`createJob` / `pollJob` / `isConfigured`).
A ~15s clip ≈ $1-3 raw cost → mark up per tenant like DataForSEO calls.

### 9.3 Tier C — narrated explainer (the flagship format)

Script → AI voiceover → assembled video. The existing scripts already do the
hard part: `video_short` is generated as a **two-column shot list** (Voiceover |
On-screen/B-roll — see `lib/content-multiformat.ts`), so narration and visuals
are already separated. Pipeline:

1. **Parse the shot list** into scenes `[{ voiceover, onScreenText, brollCue }]`. (~½ day, pure code.)
2. **TTS voiceover** — the one stage that forces a vendor. Per-scene audio +
   durations (durations drive the timeline). Options: **OpenAI TTS** (reuses the
   existing image OPENAI_API_KEY — recommended first, no new account),
   **ElevenLabs** (best quality, usage-priced), or self-hosted Piper/Coqui (no
   account, weaker).
3. **Per-scene visuals**, three sub-tiers: (a) branded text cards from the
   option-2 templates — near-zero-account, the default; (b) royalty-free stock
   B-roll (Pexels/Pixabay free API); (c) AI footage via the §9.2 usage APIs.
4. **Captions** — burn the voiceover words on-screen; no transcription needed
   (we have the exact words; TTS durations give timing).
5. **ffmpeg assembly** (render worker) — visuals + audio track + captions +
   music bed + intro/outro brand bumper + **on-screen legal disclaimer**, per
   aspect ratio.
6. **Compliance** — highest-risk item (§6). Disclaimer baked into the script
   prompt *and* rendered as an overlay, gated by the firm-wide compliance gate
   before render.

**Recommended first build:** OpenAI TTS + tier-(a) branded cards + captions +
disclaimer → a real narrated explainer with **zero new vendor relationships**.
Add ElevenLabs quality or AI footage later as paid upgrades behind the meter.

### 9.4 What's reused vs. new

Reused unchanged: `video_renders` table, storage + `persistToStorage`, the
render/status/providers endpoints, the `VideoProvider` interface, the
`cost_cents` ledger, and the per-tenant `recordVendorUsage` meter. Genuinely new
work: the render worker, the `rendered` ffmpeg provider, the image-template
frame system (shared with the no-account image feature), the script parser, a
TTS adapter, caption burn-in, and the disclaimer overlay/gate.

---

## 7a. What's built now (Phase 1)

The full async pipeline is in place behind a provider adapter. It runs today
with no credentials via the `stub` provider (which simulates an ~8s render and
returns a placeholder clip).

**Files**
- `supabase/video_renders_schema.sql` — `video_renders` table + `video-renders`
  storage bucket + RLS. **Run this in the Supabase SQL editor to activate.**
- `lib/video-providers.ts` — the `VideoProvider` interface, the registry, and
  the `stub` provider. **This is the extension point.**
- `lib/video-render.ts` — orchestration: `startRender`, `refreshRender`
  (polling drives progress), best-effort copy of the finished file into our own
  storage, `listRendersForDraft`, `deleteRender`.
- `app/api/content/video/render/route.ts` — `POST` start a render, `GET` list a
  draft's renders.
- `app/api/content/video/render/[id]/route.ts` — `GET` poll status (advances the
  job), `DELETE` remove.
- `app/api/content/video/providers/route.ts` — `GET` available providers.

**Try it (stub)**
```bash
# start a render for a video-script draft
curl -X POST localhost:3000/api/content/video/render \
  -H 'content-type: application/json' \
  -d '{"draft_id":"<a video_short or video_long draft id>"}'
# → { render: { id, status: "rendering", ... } }

# poll until succeeded (polling drives the stub forward)
curl localhost:3000/api/content/video/render/<render_id>
# → { render: { status: "succeeded", output_url, duration_seconds, ... } }
```

**Env**
- `VIDEO_PERSIST_TO_STORAGE=true` — copy finished renders into the
  `video-renders` bucket (recommended for real vendors whose URLs expire).
  Off by default; when off, the vendor URL is stored as-is.
- Real vendors add their own key, e.g. `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`.

## 7b. How to add a real vendor (or any other external system)

1. Create `lib/video-providers/<vendor>.ts` exporting a `VideoProvider`:
   - `isConfigured()` → `Boolean(process.env.<VENDOR>_API_KEY)`
   - `createJob({ script, format, options })` → POST to the vendor, return its
     `providerJobId` + initial status.
   - `pollJob(providerJobId)` → GET the vendor's job, map to `succeeded` +
     `outputUrl` / `failed` + `error` / still `rendering`.
2. Register it in the `REGISTRY` map in `lib/video-providers.ts`.
3. Add the API key to `.env`. Done — DB, endpoints, storage, and UI are unchanged.

This same adapter shape is how other job-based external systems would plug in
later (the contract is just create-job / poll-job / is-configured).

---

## 8. Open questions for Kenneth

1. **Primary use case** — authority/explainer video for the firm's own
   YouTube/site (favors Option A avatar), or high-volume social shorts (favors
   Option B stock)?
2. **Presenter** — comfortable with a synthetic AI avatar representing the firm,
   or voiceover-over-B-roll only (no face)?
3. **MarketOS productization** — single firm now, or does each tenant pick/bring
   their own render vendor + API key? (Changes whether provider config is
   global or per-tenant.)
4. **Budget ceiling** — what monthly render spend is acceptable before we add
   the hard cap?
