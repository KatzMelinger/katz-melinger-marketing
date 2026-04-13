import { NextResponse } from "next/server";

import { fetchAllFormSubmissions } from "@/lib/callrail-forms";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    return NextResponse.json({
      submissions: [],
      error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID",
    });
  }

  const result = await fetchAllFormSubmissions(apiKey, accountId);
  if (!result.ok) {
    return NextResponse.json({ submissions: [], error: result.error });
  }

  return NextResponse.json({ submissions: result.submissions });
}
