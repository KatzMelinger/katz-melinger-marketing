/**
 * GET /api/connections/health
 *
 * Health for every OAuth connection (Constant Contact, Google Business
 * Profile) — powers the connection-health badge so you catch a lapsing token
 * before a send/sync fails. Authenticated users only.
 */

import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getConnectionsHealth } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const connections = await getConnectionsHealth();
  const worst = connections.reduce<"ok" | "expiring" | "at_risk" | "disconnected">(
    (acc, c) => {
      const rank = { ok: 0, expiring: 1, at_risk: 2, disconnected: 3 } as const;
      return rank[c.status] > rank[acc] ? c.status : acc;
    },
    "ok",
  );
  return NextResponse.json({ connections, overall: worst });
}
