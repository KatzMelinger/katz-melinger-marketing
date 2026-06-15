# Usage metering — Phase 1 (advisory) — FOR REVIEW, NOT COMMITTED

**Branch:** `feat/usage-metering-phase1` (worktree at `../km-meter`)
**Status:** changes made + `tsc --noEmit` clean. **Nothing committed or pushed.** Review the diff, then commit/merge yourself when happy.

## What this is
Reseller model: firms pay us and use OUR shared vendor accounts, so WE eat the per-tenant API cost. This wires **advisory** per-tenant usage recording into the shared paid-API chokepoints, so you get per-tenant cost visibility (the basis for tiers/billing later).

**Advisory = safe.** Every record goes through `recordVendorUsage()` → `recordUsage()`, which is **best-effort and never throws and never blocks** the user's request. Nothing is gated/capped in Phase 1.

## Files changed (review with `git -C ../km-meter diff`)
- `lib/usage-meter.ts` — extended the `Meter` union with `dataforseo` / `anthropic` / `ayrshare` (+ placeholder caps, not enforced) and added `recordVendorUsage(meter, {...})` — resolves the tenant best-effort and records to the ledger.
- `lib/dataforseo-cache.ts` — meters the **single** DataForSEO chokepoint (`cachedDataForSeoPost`): live call = 1 unit, cache hit = 0 units (kept for visibility). Covers **all** DataForSEO usage.
- `lib/ayrshare.ts` — meters `postToAyrshare`: 1 unit per platform, on success. Covers **all** social posting.
- `lib/content-multiformat.ts` — meters the Claude call with real token counts (`input+output`). Covers multi-format generation, the Repurpose social posts, and Peggy's agent drafts.

## Coverage
| Vendor | Covered? | Where |
|---|---|---|
| DataForSEO (Labs + backlinks + SERP) | ✅ Full | `cachedDataForSeoPost` chokepoint |
| Ayrshare | ✅ Full | `postToAyrshare` |
| Anthropic — multi-format / social / agent drafts | ✅ | `content-multiformat` |
| Anthropic — **everything else** | ❌ Phase 1b | see below |

## ⚠️ Two prerequisites / caveats
1. **The ledger tables must exist.** Metering writes to `external_api_usage` (+ `tenant_usage_limits`) from `supabase/competitor_intel_schema.sql`. If that migration isn't applied yet, recording **silently no-ops** (best-effort) — safe, but you get no data. **Apply `competitor_intel_schema.sql` first** if it isn't already.
2. **Cron attribution.** Tenant is resolved from the request; in cron/no-request contexts it falls back to the default (KM) tenant. So scheduled DataForSEO usage (daily syncs, tracked-keyword refresh) currently attributes to KM. Phase 1b: thread `tenantId` through the cron paths.

## Phase 1b (remaining Anthropic call sites to meter)
These still call `getAnthropic().messages.create` directly and aren't metered yet. Add a `recordVendorUsage("anthropic", { units: input+output tokens, ... })` after each `resp`:
- `app/api/content/km-draft/route.ts` (the main page/blog generator — likely the biggest single spend)
- `app/api/content/draft/route.ts`
- `lib/strategy-engine.ts` (`claudeJudge`)
- `app/api/agent/route.ts` (Peggy chat) + `lib/agent/*`
- `app/api/content/intelligence/*`, `app/api/keyword-research/*`
(Each has tenant context or runs in a request, so `recordVendorUsage` resolves the tenant.)

## How to verify it's recording
After applying the schema and exercising the app (run a content gen / a keyword sync):
```sql
select tenant_id, meter, sum(units) as units, count(*) as calls,
       sum(case when cache_hit then 1 else 0 end) as cache_hits
from external_api_usage
where created_at >= date_trunc('month', now())
group by tenant_id, meter
order by units desc;
```

## Phase 2 (enforcement / billing — NOT in this branch)
Once you've seen real numbers and defined plan tiers:
- Seed `tenant_usage_limits` per meter per plan.
- Swap advisory `recordVendorUsage` for `consumeUsageUnit` (atomic reserve + hard cap) at the chokepoints you want to gate, with `releaseUsageUnit`/`markReservationCacheHit` on failure/cache-hit (the competitor-ads path already does this — copy that pattern).
