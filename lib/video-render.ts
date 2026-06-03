/**
 * Orchestration for the rendered-video pipeline.
 *
 * Renders are async (vendors take minutes), so this is a job model, not a
 * blocking call:
 *   startRender()   — validate the draft, ask the provider to create a job,
 *                     insert a `video_renders` row (status queued/rendering),
 *                     return immediately.
 *   refreshRender() — poll the provider for a job's current status; on success,
 *                     optionally copy the finished file into our own storage so
 *                     the URL doesn't expire; update + return the row.
 *
 * The provider is swappable — see lib/video-providers.ts.
 */

import { getSupabaseAdmin } from "./supabase-server";
import {
  getVideoProvider,
  type RenderOptions,
  type RenderStatus,
} from "./video-providers";

const BUCKET = "video-renders";

export type VideoRender = {
  id: string;
  draft_id: string | null;
  provider: string;
  provider_job_id: string | null;
  status: RenderStatus;
  options: Record<string, unknown>;
  output_url: string | null;
  storage_path: string | null;
  duration_seconds: number | null;
  cost_cents: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** Error carrying an HTTP status so routes can map it cleanly. */
export class RenderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function startRender(args: {
  draftId: string;
  providerId: string;
  options?: RenderOptions;
}): Promise<VideoRender> {
  const sb = getSupabaseAdmin();
  const options = args.options ?? {};

  const { data: draft, error: draftErr } = await sb
    .from("content_drafts")
    .select("id, body, title, format")
    .eq("id", args.draftId)
    .maybeSingle();
  if (draftErr) throw new RenderError(draftErr.message, 500);
  if (!draft) throw new RenderError("draft not found", 404);
  if (!String((draft as { format: string }).format).startsWith("video_")) {
    throw new RenderError(
      "draft is not a video script (format must be video_short or video_long)",
      400,
    );
  }

  const provider = getVideoProvider(args.providerId);
  if (!provider) throw new RenderError(`unknown provider: ${args.providerId}`, 400);
  if (!provider.isConfigured()) {
    throw new RenderError(
      `provider "${args.providerId}" is not configured (missing API key)`,
      503,
    );
  }

  const d = draft as { body: string; title: string | null; format: string };
  const job = await provider.createJob({
    script: d.body,
    title: d.title,
    format: d.format,
    options,
  });

  const { data: row, error } = await sb
    .from("video_renders")
    .insert({
      draft_id: args.draftId,
      provider: provider.id,
      provider_job_id: job.providerJobId,
      status: job.status,
      options,
      cost_cents: job.estimatedCostCents ?? null,
    })
    .select("*")
    .single();
  if (error || !row) {
    throw new RenderError(error?.message ?? "failed to record render job", 500);
  }
  return row as VideoRender;
}

export async function getRender(id: string): Promise<VideoRender | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("video_renders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as VideoRender) ?? null;
}

export async function listRendersForDraft(draftId: string): Promise<VideoRender[]> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("video_renders")
    .select("*")
    .eq("draft_id", draftId)
    .order("created_at", { ascending: false });
  return (data as VideoRender[]) ?? [];
}

/**
 * Poll the provider for a non-terminal render and persist any state change.
 * Terminal renders (succeeded/failed) are returned untouched. Called by the
 * status endpoint, so the UI's polling drives job progression.
 */
export async function refreshRender(id: string): Promise<VideoRender | null> {
  const sb = getSupabaseAdmin();
  const row = await getRender(id);
  if (!row) return null;
  if (row.status === "succeeded" || row.status === "failed") return row;

  const provider = getVideoProvider(row.provider);
  if (!provider || !row.provider_job_id) {
    return updateRender(id, {
      status: "failed",
      error: provider ? "missing provider job id" : `unknown provider: ${row.provider}`,
    });
  }

  const poll = await provider.pollJob(row.provider_job_id);
  const patch: Partial<VideoRender> = { status: poll.status };

  if (poll.status === "succeeded") {
    let outputUrl = poll.outputUrl ?? null;
    let storagePath: string | null = null;
    // Vendor URLs often expire; copy the file into our own bucket when enabled.
    if (outputUrl && process.env.VIDEO_PERSIST_TO_STORAGE === "true") {
      const persisted = await persistToStorage(id, outputUrl);
      if (persisted) {
        outputUrl = persisted.publicUrl;
        storagePath = persisted.path;
      }
    }
    patch.output_url = outputUrl;
    patch.storage_path = storagePath;
    patch.duration_seconds = poll.durationSeconds ?? null;
    if (poll.costCents != null) patch.cost_cents = poll.costCents;
  } else if (poll.status === "failed") {
    patch.error = poll.error ?? "render failed";
  }

  return updateRender(id, patch);
}

async function updateRender(
  id: string,
  patch: Partial<VideoRender>,
): Promise<VideoRender> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("video_renders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new RenderError(error?.message ?? "failed to update render", 500);
  }
  return data as VideoRender;
}

/**
 * Download a finished render from the vendor URL and re-upload it to the
 * `video-renders` bucket. Best-effort: returns null on any failure so the
 * caller falls back to the vendor URL.
 */
async function persistToStorage(
  renderId: string,
  outputUrl: string,
): Promise<{ path: string; publicUrl: string } | null> {
  try {
    const res = await fetch(outputUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sb = getSupabaseAdmin();
    const yyyymm = new Date().toISOString().slice(0, 7); // shardable path
    const path = `${yyyymm}/${renderId}.mp4`;
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (error) return null;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return { path, publicUrl: data.publicUrl };
  } catch {
    return null;
  }
}

export async function deleteRender(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const row = await getRender(id);
  if (row?.storage_path) {
    await sb.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
  }
  await sb.from("video_renders").delete().eq("id", id);
}
