/**
 * GET /api/keyword-research/expand/status?id=<jobId>
 *
 * Returns the current state of an expand job. See discover/status for the
 * full pattern explanation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/keyword-research-jobs";

export const runtime = "nodejs";
export const maxDuration = 10;

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

    return NextResponse.json({
      status: job.status,
      startedAt: job.started_at,
      elapsedMs: job.started_at
        ? Date.now() - new Date(job.started_at).getTime()
        : 0,
    });
  } catch (err: any) {
    console.error("[expand/status] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to check job status" },
      { status: 500 },
    );
  }
}