/**
 * POST /api/ai-bots/ingest
 *   body: { userAgent: string, path?: string, host?: string, status?: number, ipHash?: string, meta?: object }
 *   OR detects user-agent from the request headers if userAgent not provided.
 *
 * Receives a single AI bot crawl observation from any source (WordPress
 * plugin, Cloudflare Worker, manual log import) and persists it to
 * ai_bot_hits.
 *
 * This endpoint is session-less so external crawl collectors (WP plugin,
 * Cloudflare Worker, log importer) can fire-and-forget. Two layers of abuse
 * protection:
 *   1. We accept only requests whose user-agent matches a known AI bot —
 *      anything else returns 400 so this can't be a generic logging sink.
 *   2. OPTIONAL HMAC: when AI_BOTS_INGEST_SECRET is set, every request must
 *      carry a valid `X-KM-Ingest-Signature: sha256=<hex>` over the raw body.
 *      This stops anyone forging a known bot UA to inject/poison ai_bot_hits
 *      rows (including the host→tenant attribution). Leave the env var unset to
 *      keep the endpoint open (legacy collectors that don't sign yet).
 *
 * Production hardening (still TODO): rate-limit per IP hash; TTL old rows.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { detectAiBot } from "@/lib/ai-bot-detect";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantIdByDomain } from "@/lib/tenant-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify the HMAC signature when a secret is configured. Returns true (allow)
 *  when AI_BOTS_INGEST_SECRET is unset so the endpoint stays backward-compatible. */
function verifyIngestSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.AI_BOTS_INGEST_SECRET?.trim();
  if (!secret) return true;
  if (!header) return false;
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Read the raw body once so the HMAC is computed over the exact bytes sent.
  const raw = await req.text();
  if (!verifyIngestSignature(raw, req.headers.get("x-km-ingest-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
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
