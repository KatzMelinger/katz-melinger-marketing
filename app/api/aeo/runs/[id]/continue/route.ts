/**
 * POST /api/aeo/runs/[id]/continue
 *
 * Continue a sweep in a fresh invocation (Oct 20 spec, Part 2 item 6). Called
 * by the sweep itself with the CRON_SECRET bearer when one chunk ends with
 * prompts left, and by the AEO page's Retry button on a failed or stalled run.
 * Answers at once; the work runs in after(). Prompts the run already answered
 * are skipped, so a retry never repeats them.
 */
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { executeAndContinue, superviseRun } from "@/lib/aeo-runner";
import { getTenantClient } from "@/lib/tenant-db";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cron = isAuthorizedCron(req);
  if (!cron) {
    const denied = await guardUser();
    if (denied) return denied;
  }

  // A signed-in user only reaches their own tenant's runs (RLS-scoped read).
  const { data: run } = cron
    ? await getSupabaseAdmin().from("aeo_runs").select("id, status").eq("id", id).maybeSingle()
    : await (await getTenantClient()).supabase.from("aeo_runs").select("id, status").eq("id", id).maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.status === "done") return NextResponse.json({ error: "This sweep already finished." }, { status: 409 });

  // A person pressing Retry on a run that is still moving would start a
  // second worker on the same prompts.
  if (!cron && run.status !== "failed" && (await superviseRun(id)) === "ok") {
    return NextResponse.json({ error: "This sweep is still running." }, { status: 409 });
  }

  after(executeAndContinue(req.nextUrl.origin, id));
  return NextResponse.json({ ok: true, runId: id });
}
