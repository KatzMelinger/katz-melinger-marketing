"use client";

/**
 * Brand image style — visual style guide applied to every generated image
 * (unless the user opts out via the "Use brand style" toggle on the generator).
 *
 * Same shape as /brand-voice for textual content: one form, key/value fields,
 * Save persists to `image_style_settings`. The generate + edit routes load
 * this on every request and append it to the user's prompt.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  IMAGE_STYLE_KEYS,
  type ImageStyleKey,
  type ImageStyleSettings,
} from "@/lib/image-style";

const FIELD_LABELS: Record<ImageStyleKey, string> = {
  visualDirection: "Visual direction",
  colorPalette: "Color palette",
  moodTone: "Mood and tone",
  composition: "Composition rules",
  avoidList: "Avoid",
};

const FIELD_PLACEHOLDERS: Record<ImageStyleKey, string> = {
  visualDirection:
    "e.g. Photorealistic editorial, soft natural light, NYC professional settings. Modern minimal staging. Lean toward documentary realism over polished studio.",
  colorPalette:
    "e.g. Primary: #185FA5 (KM blue). Accent: warm amber. Neutrals: charcoal, off-white, slate. Avoid pure black and neon colors.",
  moodTone:
    "e.g. Confident, authoritative, but approachable. Empathetic — these are people who've been wronged. Avoid corporate stiffness or stock-photo cheerfulness.",
  composition:
    "e.g. Eye-level shots, rule of thirds. Negative space on the right for headline overlays. People should look engaged, not posed. Show hands and small details — paperwork, coffee, computer screens.",
  avoidList:
    "e.g. No gavels, no scales of justice, no courthouse columns, no stock-photo handshakes. No staged group photos. No legal cliches.",
};

const FIELD_HINTS: Record<ImageStyleKey, string> = {
  visualDirection:
    "Overall feel — photorealistic vs illustration, polished vs documentary, color treatment, etc.",
  colorPalette:
    "Hex codes for primary/accent colors and brand neutrals. The model will use these when colors are visible in the scene.",
  moodTone:
    "How should the subject and atmosphere feel? Helps the model pick lighting, expressions, framing.",
  composition:
    "Camera angle, framing, where to leave space for text overlays, what details to emphasize.",
  avoidList:
    "Explicit don'ts — the model is told to actively avoid these. Be specific (\"no gavels\" works better than \"avoid clichés\").",
};

export default function ImageStylePage() {
  const [style, setStyle] = useState<ImageStyleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/images/style", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setStyle(d.style as ImageStyleSettings);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!style) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/images/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "save failed");
      setStyle(json.style as ImageStyleSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Images
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Brand image style
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          These guidelines are appended to every prompt sent to the image
          generator (and to edits) so output stays on-brand. The toggle on{" "}
          <Link
            className="text-violet-700 underline-offset-2 hover:underline"
            href="/content/images"
          >
            /content/images
          </Link>{" "}
          lets you bypass them for one-off prompts.
        </p>
      </header>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {style && (
        <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {IMAGE_STYLE_KEYS.map((key) => (
            <div key={key}>
              <label
                htmlFor={key}
                className="block text-sm font-semibold text-slate-800"
              >
                {FIELD_LABELS[key]}
              </label>
              <p className="mt-0.5 text-xs text-slate-500">{FIELD_HINTS[key]}</p>
              <textarea
                id={key}
                rows={key === "avoidList" ? 3 : 4}
                value={style[key]}
                onChange={(e) =>
                  setStyle((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))
                }
                placeholder={FIELD_PLACEHOLDERS[key]}
                className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>
          ))}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save style"}
            </button>
            {saved && (
              <span className="text-sm text-emerald-700">Saved ✓</span>
            )}
            <Link
              href="/content/images"
              className="ml-auto text-sm text-slate-600 hover:text-slate-900"
            >
              Back to generator →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
