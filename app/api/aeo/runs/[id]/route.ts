/**
 * GET /api/aeo/runs/[id]
 *
 * Returns the status row for a single run (used for poll-while-running),
 * plus prompts_done for "N of M prompts". Looking at a run also supervises
 * it: a run with no progress for 6 minutes is resumed, and after 20 minutes
 * it is marked failed with the reason (Oct 20 spec, Part 2 item 6).
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { answeredPromptIds, executeAndContinue, superviseRun } from "@/lib/aeo-runner";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase } = await getTenantClient();
  // RLS-scoped existence check before the admin-side supervision.
  const { data: own } = await supabase.from("aeo_runs").select("id").eq("id", id).maybeSingle();
  if (own && (await superviseRun(id)) === "stalled") after(executeAndContinue(req.nextUrl.origin, id));
  const { data, error } = await supabase
    .from("aeo_runs")
    .select("id, status, providers, prompt_count, response_count, failure_count, started_at, completed_at, triggered_by, error, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const promptsDone = (await answeredPromptIds(id)).size;
  return NextResponse.json({ ...data, prompts_done: promptsDone });
}
