import { NextResponse } from "next/server";

import { fetchAllCallRailCalls } from "@/lib/callrail-fetch";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    return NextResponse.json({
      calls: [],
      error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID",
    });
  }

  const result = await fetchAllCallRailCalls(apiKey, accountId);

  if (!result.ok) {
    return NextResponse.json({ calls: [], error: result.error });
  }

  return NextResponse.json({ calls: result.calls });
}
