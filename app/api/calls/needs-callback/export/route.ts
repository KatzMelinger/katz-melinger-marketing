/**
 * GET /api/calls/needs-callback/export?format=pdf|csv&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     [&source=...&result=missed|voicemail&caller=first|repeat&language=en|es|...]
 *
 * Oct 20 spec, Task A19: the Needs callback list as a file to print or hand
 * to whoever makes the calls. Same rule and same filters as the Calls page.
 */
import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { isIsoDate, monthToDate } from "@/lib/calls-stats";
import { callbacksCsv, callbacksPdf, loadCallbacks, type CallbackFilters } from "@/lib/callback-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const d = monthToDate(Date.now());
  const f: CallbackFilters = {
    from: isIsoDate(sp.get("from")) ? (sp.get("from") as string) : d.from,
    to: isIsoDate(sp.get("to")) ? (sp.get("to") as string) : d.to,
    source: sp.get("source"),
    result: sp.get("result"),
    caller: sp.get("caller"),
    language: sp.get("language"),
  };
  try {
    const rows = await loadCallbacks(await resolveTenantId(), f);
    const name = `needs-callback-${f.from}-to-${f.to}`;
    if (sp.get("format") === "csv") {
      return new NextResponse(callbacksCsv(rows), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
      });
    }
    return new NextResponse(new Uint8Array(callbacksPdf(rows, f)), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"` },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
