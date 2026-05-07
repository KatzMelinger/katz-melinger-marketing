/**
 * GET /api/keyword-research/discover/status?id=<jobId>
 *
 * Returns the current state of a job. The frontend polls this every few
 * seconds while a job is running.
 *
 * Response shape:
 *   { status: "pending" | "running" }
 *   { status: "done", result: <parsed AI response> }
 *   { status: "failed", error: "<message>" }
 *
 * The status endpoint is shared in spirit with expand and competitor-gaps —
 * each route has its own copy that points at the same job table. We keep them
 * separate per-route to keep paths simple in the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/keyword-research-jobs";

export const runtime = "nodejs";
export const maxDuration = 10; // status check is just a Supabase read

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("id");
    if (!jobId) {
      return NextResponse.json(
        { error: "Missing required query param: id" },
        { status: 400 },
      );
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "done") {
      return NextResponse.json({
        status: "done",
        result: job.result,
        elapsedMs:
          job.completed_at && job.started_at
            ? new Date(job.completed_at).getTime() -
              new Date(job.started_at).getTime()
            : null,
      });
    }

    if (job.status === "failed") {
      return NextResponse.json({
        status: "failed",
        error: job.error || "Unknown error",
      });
    }

    // pending or running — tell the client to keep polling
    return NextResponse.json({
      status: job.status,
      startedAt: job.started_at,
      elapsedMs: job.started_at
        ? Date.now() - new Date(job.started_at).getTime()
        : 0,
    });
  } catch (err: any) {
    console.error("[discover/status] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to check job status" },
      { status: 500 },
    );
  }
}