"use client";

/**
 * Image generator + library.
 *
 * Text-prompt → PNG via OpenAI gpt-image-1. All outputs are persisted to
 * Supabase storage + the `generated_images` table so the marketer can leave
 * the page, come back, and still see their library. Each generated image can
 * be edited with a follow-up prompt — the result is saved as a new row linked
 * to its parent so we have a lineage.
 *
 * Accepts ?prompt=... in the URL so other pages (content analysis, social
 * playbook visual ideas) can deep-link in with a prefilled prompt.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
type ImageQuality = "low" | "medium" | "high" | "auto";

type SavedImage = {
  id: string;
  prompt: string;
  size: string;
  quality: string;
  storage_path: string;
  public_url: string;
  parent_image_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

const SIZES: { value: ImageSize; label: string }[] = [
  { value: "1024x1024", label: "Square 1:1 (1024)" },
  { value: "1536x1024", label: "Landscape 3:2 (1536×1024)" },
  { value: "1024x1536", label: "Portrait 2:3 (1024×1536)" },
  { value: "auto", label: "Auto" },
];

const QUALITIES: { value: ImageQuality; label: string }[] = [
  { value: "low", label: "Low (fastest, ~$0.01)" },
  { value: "medium", label: "Medium (~$0.04)" },
  { value: "high", label: "High (best, ~$0.17)" },
  { value: "auto", label: "Auto" },
];

function ImageGenerator() {
  const params = useSearchParams();

  // New-image form
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1024x1024");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Library
  const [library, setLibrary] = useState<SavedImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);

  // Edit panel
  const [editTarget, setEditTarget] = useState<SavedImage | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Prefill prompt from URL.
  useEffect(() => {
    const incoming = params.get("prompt");
    if (incoming) setPrompt(incoming);
  }, [params]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch("/api/images/list?limit=48", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setLibrary(data.images ?? []);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const lineageById = useMemo(() => {
    const m = new Map<string, SavedImage>();
    for (const img of library) m.set(img.id, img);
    return m;
  }, [library]);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size, quality }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setLibrary((prev) => [json.image as SavedImage, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    setEditError(null);
    setEditing(true);
    try {
      const res = await fetch("/api/images/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentImageId: editTarget.id,
          prompt: editPrompt,
          size: editTarget.size,
          quality: editTarget.quality,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setLibrary((prev) => [json.image as SavedImage, ...prev]);
      setEditPrompt("");
      setEditTarget(json.image as SavedImage); // keep editing on the new one
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setEditing(false);
    }
  }

  async function handleDelete(img: SavedImage) {
    if (!confirm("Delete this image? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/images/${img.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setLibrary((prev) => prev.filter((x) => x.id !== img.id));
      if (editTarget?.id === img.id) setEditTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function downloadImage(img: SavedImage) {
    const a = document.createElement("a");
    a.href = img.public_url;
    a.download = `km-image-${img.id}.png`;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Image generator</h1>
        <p className="mt-1 text-sm text-slate-600">
          Describe what you want — get a download-ready PNG. Powered by OpenAI
          gpt-image-1. All images are saved to your library; click any to edit
          it with a follow-up prompt.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <label
          htmlFor="prompt"
          className="block text-sm font-medium text-slate-700"
        >
          Prompt
        </label>
        <textarea
          id="prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A confident NYC employment lawyer in a sharp navy suit, sitting at a modern desk in a Manhattan high-rise, golden hour light, photorealistic, editorial style."
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="size"
              className="block text-sm font-medium text-slate-700"
            >
              Size
            </label>
            <select
              id="size"
              value={size}
              onChange={(e) => setSize(e.target.value as ImageSize)}
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="quality"
              className="block text-sm font-medium text-slate-700"
            >
              Quality
            </label>
            <select
              id="quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value as ImageQuality)}
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate image"}
          </button>
          {generating && (
            <span className="text-sm text-slate-500">
              This can take 10–40 seconds.
            </span>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </section>

      {editTarget && (
        <section className="mt-6 rounded-lg border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={editTarget.public_url}
              alt={editTarget.prompt}
              className="h-32 w-32 rounded-md border border-slate-200 object-cover"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Edit image
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditTarget(null);
                    setEditPrompt("");
                    setEditError(null);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Describe what to change — "make the background darker", "swap
                the suit for grey", "add a Manhattan skyline behind the desk".
                The output is saved as a new image linked to this one.
              </p>
              <textarea
                rows={3}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="Make the lighting cooler and add a New York skyline through the window."
                className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={editing || !editPrompt.trim()}
                  className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editing ? "Editing…" : "Apply edit"}
                </button>
                {editing && (
                  <span className="text-sm text-slate-500">
                    Can take 20–60 seconds.
                  </span>
                )}
              </div>
              {editError && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {editError}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Library
          </h2>
          <button
            type="button"
            onClick={loadLibrary}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Refresh
          </button>
        </div>

        {libraryLoading && library.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : library.length === 0 ? (
          <p className="text-sm text-slate-500">
            No images yet. Generate one above.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {library.map((img) => {
              const parent = img.parent_image_id
                ? lineageById.get(img.parent_image_id)
                : null;
              return (
                <figure
                  key={img.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.public_url}
                    alt={img.prompt}
                    className="block aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <figcaption className="border-t border-slate-200 p-3">
                    {parent && (
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-violet-700">
                        Edit of earlier image
                      </div>
                    )}
                    <p
                      className="line-clamp-3 text-xs text-slate-700"
                      title={img.prompt}
                    >
                      {img.prompt}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{new Date(img.created_at).toLocaleString()}</span>
                      <span>
                        {img.size} · {img.quality}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditTarget(img);
                          setEditPrompt("");
                          setEditError(null);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadImage(img)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(img)}
                        className="ml-auto rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ImageGeneratorPage() {
  return (
    <Suspense fallback={null}>
      <ImageGenerator />
    </Suspense>
  );
}
