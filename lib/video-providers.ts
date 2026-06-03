/**
 * Video render provider adapters.
 *
 * THIS IS THE EXTENSION POINT. To add a real vendor (HeyGen, ElevenLabs,
 * Synthesia, Pictory, …) — or, later, any other external job-based system —
 * implement the `VideoProvider` interface in a new file and register it in
 * REGISTRY below. Nothing else in the pipeline (DB schema, API routes, UI,
 * storage) needs to change.
 *
 * The contract is intentionally tiny and async-job shaped:
 *   - createJob()  → kick off a render, return the vendor's job handle
 *   - pollJob()    → ask the vendor where that job is
 *   - isConfigured() → is the API key / config present?
 *
 * A `stub` provider ships by default so the whole pipeline is runnable with
 * zero credentials. It simulates a render that "finishes" after a few seconds
 * and returns a placeholder video URL.
 */

export type RenderStatus = "queued" | "rendering" | "succeeded" | "failed";

/** Free-form per-render knobs. Each vendor reads the keys it understands. */
export type RenderOptions = {
  voiceId?: string;
  avatarId?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  captions?: boolean;
  [key: string]: unknown;
};

export type CreateJobInput = {
  /** The script body from the content_drafts row. */
  script: string;
  title?: string | null;
  /** video_short | video_long — lets a vendor pick aspect/length defaults. */
  format: string;
  options: RenderOptions;
};

export type CreateJobResult = {
  providerJobId: string;
  status: RenderStatus; // usually "queued" or "rendering"
  estimatedCostCents?: number;
};

export type PollResult = {
  status: RenderStatus;
  /** Present when succeeded: a (often temporary) vendor-hosted file URL. */
  outputUrl?: string;
  durationSeconds?: number;
  costCents?: number;
  /** Present when failed. */
  error?: string;
};

export interface VideoProvider {
  /** Stable id stored in video_renders.provider, e.g. "stub", "heygen". */
  readonly id: string;
  /** Human label for the UI provider picker. */
  readonly label: string;
  /** True when the vendor's API key / config is present in the environment. */
  isConfigured(): boolean;
  createJob(input: CreateJobInput): Promise<CreateJobResult>;
  pollJob(providerJobId: string): Promise<PollResult>;
}

// ============================================================================
// Stub provider — no credentials, simulates an async render.
// ============================================================================

/** How long the stub pretends a render takes before "succeeding". */
const STUB_RENDER_MS = 8_000;

/**
 * A clearly-fake placeholder clip so the success state is demoable end-to-end.
 * Replace by a real vendor adapter — this is NOT a real render of the script.
 */
const STUB_SAMPLE_URL =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

const stubProvider: VideoProvider = {
  id: "stub",
  label: "Stub (no vendor — placeholder render)",
  isConfigured() {
    return true; // works with zero config so the pipeline is runnable today
  },
  async createJob(input) {
    // Encode the start time in the job id so pollJob can simulate progress
    // without any external state. (Date.now() is fine in route/lib code.)
    const rand = Math.random().toString(36).slice(2, 8);
    const providerJobId = `stub-${Date.now()}-${rand}`;
    void input; // a real vendor would POST input.script here
    return { providerJobId, status: "rendering", estimatedCostCents: 0 };
  },
  async pollJob(providerJobId) {
    const startedAt = Number(providerJobId.split("-")[1]);
    const elapsed = Number.isFinite(startedAt) ? Date.now() - startedAt : Infinity;
    if (elapsed < STUB_RENDER_MS) {
      return { status: "rendering" };
    }
    return {
      status: "succeeded",
      outputUrl: STUB_SAMPLE_URL,
      durationSeconds: 15,
      costCents: 0,
    };
  },
};

// ============================================================================
// Registry
// ============================================================================

const REGISTRY: Record<string, VideoProvider> = {
  [stubProvider.id]: stubProvider,
  // heygen:     heygenProvider,      // ← add real adapters here
  // elevenlabs: elevenLabsProvider,
};

export const DEFAULT_PROVIDER_ID = "stub";

export function getVideoProvider(id: string): VideoProvider | null {
  return REGISTRY[id] ?? null;
}

export function listVideoProviders(): VideoProvider[] {
  return Object.values(REGISTRY);
}
