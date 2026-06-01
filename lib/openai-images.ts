/**
 * Thin wrapper for OpenAI's gpt-image-1 generate + edit endpoints. Used by
 * /api/images/generate and /api/images/edit.
 *
 * gpt-image-1 always returns base64-encoded PNGs (no hosted URLs), so callers
 * get back `b64_json` strings they can decode + upload to Supabase storage.
 */

const GENERATE_ENDPOINT = "https://api.openai.com/v1/images/generations";
const EDIT_ENDPOINT = "https://api.openai.com/v1/images/edits";

export type ImageSize =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "auto";

export type ImageQuality = "low" | "medium" | "high" | "auto";

export type GeneratedImage = { b64_json: string };

function requireApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return apiKey;
}

export async function generateImages(opts: {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
}): Promise<GeneratedImage[]> {
  const res = await fetch(GENERATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey()}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: opts.prompt,
      size: opts.size ?? "1024x1024",
      quality: opts.quality ?? "medium",
      n: Math.max(1, Math.min(opts.n ?? 1, 4)),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI image API ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: GeneratedImage[] };
  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw new Error("OpenAI returned no image data");
  }
  return json.data;
}

/**
 * Build the multipart body shared by the edits-endpoint calls (single-image
 * edit + multi-reference generation) and POST it. `images` becomes one or more
 * `image[]` form entries — gpt-image-1 accepts an array of reference images.
 */
async function postToEditEndpoint(opts: {
  prompt: string;
  images: Uint8Array[];
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  errorLabel: string;
}): Promise<GeneratedImage[]> {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", opts.prompt);
  form.append("size", opts.size ?? "1024x1024");
  form.append("quality", opts.quality ?? "medium");
  form.append("n", String(Math.max(1, Math.min(opts.n ?? 1, 4))));
  // A single image still uses the array field name — the API accepts both, and
  // `image[]` keeps the single- and multi-reference paths identical.
  opts.images.forEach((bytes, i) => {
    form.append(
      "image[]",
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      `ref-${i}.png`,
    );
  });

  const res = await fetch(EDIT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireApiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${opts.errorLabel} ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: GeneratedImage[] };
  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw new Error("OpenAI returned no image data");
  }
  return json.data;
}

/**
 * Edit an existing PNG with a follow-up prompt. The source bytes are passed in
 * directly so the caller can fetch them from Supabase storage and forward them
 * without staging to disk.
 */
export async function editImage(opts: {
  imageBytes: Uint8Array;
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
}): Promise<GeneratedImage[]> {
  return postToEditEndpoint({
    prompt: opts.prompt,
    images: [opts.imageBytes],
    size: opts.size,
    quality: opts.quality,
    n: opts.n,
    errorLabel: "OpenAI image edit",
  });
}

/**
 * Generate a NEW image guided by one or more reference images (uploaded brand
 * design files). gpt-image-1 has no reference input on the generations
 * endpoint, so this goes through the edits endpoint with the references as
 * `image[]` — the prompt describes the new image, the references anchor the
 * visual style.
 */
export async function generateWithReferences(opts: {
  prompt: string;
  referenceImages: Uint8Array[];
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
}): Promise<GeneratedImage[]> {
  if (opts.referenceImages.length === 0) {
    throw new Error("generateWithReferences requires at least one reference");
  }
  return postToEditEndpoint({
    prompt: opts.prompt,
    images: opts.referenceImages,
    size: opts.size,
    quality: opts.quality,
    n: opts.n,
    errorLabel: "OpenAI reference generation",
  });
}
