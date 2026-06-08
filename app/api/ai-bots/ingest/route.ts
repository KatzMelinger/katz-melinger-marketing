/**
 * POST /api/ai-bots/ingest
 *   body: { userAgent: string, path?: string, host?: string, status?: number, ipHash?: string, meta?: object }
 *   OR detects user-agent from the request headers if userAgent not provided.
 *
 * Receives a single AI bot crawl observation from any source (WordPress
 * plugin, Cloudflare Worker, manual log import) and persists it to
 * ai_bot_hits.
 *
 * This endpoint is intentionally public (no auth) so external crawl
 * collectors can fire-and-forget without managing sessions. We accept
 * only requests whose user-agent matches a known AI bot — anything else
 * returns 400 so this can't be used as a generic logging sink.
 *
 * Production hardening (later):
 *   - Add HMAC-signed shared-secret header
 *   - Rate-limit per IP hash
 *   - Drop ingest writes if the bot table is older than N days (TTL)
 */

import { NextRequest, NextResponse } from "next/server";

import { detectAiBot } from "@/lib/ai-bot-detect";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantIdByDomain } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* may have no body — fall through and use headers */
  }

  const ua =
    (typeof body.userAgent === "string" ? body.userAgent : null) ??
    req.headers.get("user-agent") ??
    "";

  const detected = detectAiBot(ua);
  if (!detected) {
    return NextResponse.json(
      { error: "user-agent does not match a known AI bot", userAgent: ua },
      { status: 400 },
    );
  }

  const path = typeof body.path === "string" ? body.path : null;
  const host = typeof body.host === "string" ? body.host : null;
  const status = typeof body.status === "number" ? body.status : null;
  const ipHash = typeof body.ipHash === "string" ? body.ipHash : null;
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {};

  try {
    const sb = getSupabaseAdmin();
    // Session-less endpoint: derive the tenant from the crawled host.
    const tenantId = await resolveTenantIdByDomain(
      host ?? req.headers.get("host"),
    );
    const { error } = await sb.from("ai_bot_hits").insert({
      bot: detected.bot,
      user_agent: ua,
      host,
      path,
      status,
      ip_hash: ipHash,
      meta: { vendor: detected.vendor, purpose: detected.purpose, ...meta },
      tenant_id: tenantId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, bot: detected.bot, vendor: detected.vendor });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingest failed" },
      { status: 500 },
    );
  }
}
