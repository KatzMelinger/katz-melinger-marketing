/**
 * GET /api/ai-bots/recent
 *   ?days=30  (default 30, max 90)
 *
 * Aggregated AI bot crawl stats from ai_bot_hits — totals, by bot,
 * by day, and the most recent raw hits for spot-checking.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type Hit = {
  bot: string;
  user_agent: string | null;
  host: string | null;
  path: string | null;
  status: number | null;
  hit_at: string;
  meta: { vendor?: string; purpose?: string } | null;
};

export async function GET(req: NextRequest) {
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Math.min(Math.max(Number.isFinite(daysParam) ? daysParam : 30, 1), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json(
      {
        totals: { hits: 0, uniqueBots: 0 },
        byBot: [],
        byDay: [],
        recent: [],
        configured: false,
      },
    );
  }

  // Pull a reasonable cap of recent rows — 10k is overkill but fast on
  // ai_bot_hits.hit_at index. Aggregations happen server-side here.
  const { data, error } = await sb
    .from("ai_bot_hits")
    .select("bot, user_agent, host, path, status, hit_at, meta")
    .eq("tenant_id", await resolveTenantId())
    .gte("hit_at", since)
    .order("hit_at", { ascending: false })
    .limit(10000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Hit[];

  // by bot
  const byBotMap = new Map<string, { bot: string; vendor: string; hits: number; lastSeen: string }>();
  for (const r of rows) {
    const key = r.bot;
    const cur = byBotMap.get(key);
    if (cur) {
      cur.hits++;
      if (r.hit_at > cur.lastSeen) cur.lastSeen = r.hit_at;
    } else {
      byBotMap.set(key, {
        bot: r.bot,
        vendor: r.meta?.vendor ?? "Unknown",
        hits: 1,
        lastSeen: r.hit_at,
      });
    }
  }
  const byBot = Array.from(byBotMap.values()).sort((a, b) => b.hits - a.hits);

  // by day (YYYY-MM-DD)
  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const d = r.hit_at.slice(0, 10);
    byDayMap.set(d, (byDayMap.get(d) ?? 0) + 1);
  }
  const byDay = Array.from(byDayMap.entries())
    .map(([date, hits]) => ({ date, hits }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // top paths
  const byPathMap = new Map<string, { path: string; hits: number; bots: Set<string> }>();
  for (const r of rows) {
    if (!r.path) continue;
    const cur = byPathMap.get(r.path);
    if (cur) {
      cur.hits++;
      cur.bots.add(r.bot);
    } else {
      byPathMap.set(r.path, { path: r.path, hits: 1, bots: new Set([r.bot]) });
    }
  }
  const byPath = Array.from(byPathMap.values())
    .map((p) => ({ path: p.path, hits: p.hits, bots: Array.from(p.bots) }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 30);

  return NextResponse.json({
    days,
    configured: true,
    totals: {
      hits: rows.length,
      uniqueBots: byBot.length,
    },
    byBot,
    byDay,
    byPath,
    recent: rows.slice(0, 50),
  });
}
