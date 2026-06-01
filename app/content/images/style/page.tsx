"use client";

/**
 * Brand image style — visual style guide applied to generated images.
 *
 * Two layers:
 *  1. General guide — the 5 structured fields (visual direction, palette, mood,
 *     composition, avoid). Applies to every channel.
 *  2. Per-channel sub-styles — a free-form notes box + uploaded design-reference
 *     files for each marketing channel (social carousels, social posts, blog,
 *     website, newsletter). On generation the selected channel's notes are
 *     appended to the general guide and its uploads are fed to the image model
 *     as visual references.
 *
 * The generate + edit routes load this on every request. The "Apply brand image
 * style" toggle + channel selector on /content/images choose what's applied.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import {
  CHANNEL_LABELS,
  IMAGE_STYLE_KEYS,
  type ChannelNotes,
  type ImageStyleKey,
  type ImageStyleSettings,
  type StyleChannel,
} from "@/lib/image-style";

type StyleAsset = {
  id: string;
  channel: string;
  storage_path: string;
  public_url: string;
  filename: string | null;
  content_type: string | null;
  created_at: string;
};

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

const CHANNEL_PLACEHOLDERS: Record<StyleChannel, string> = {
  social_carousel:
    "e.g. Square 1:1 slides. Bold headline top-left, lots of negative space for text. Consistent slide framing across the set. High contrast so text stays legible.",
  social_post:
    "e.g. Single eye-catching hero image. Subject centered or rule-of-thirds. Punchy, scroll-stopping. Leave room for a short caption overlay.",
  blog: "e.g. Wide 3:2 hero images. Editorial, story-driven. Subtle, not loud — supports the headline rather than competing with it.",
  website:
    "e.g. Clean banner-friendly compositions, generous negative space for overlaid copy and CTAs. On-brand blue accents. Trustworthy, polished.",
  newsletter:
    "e.g. Warm, personal, inbox-friendly. Smaller focal subject that reads at thumbnail size. Consistent header treatment.",
};

// Grouping for display: Social media has two subsections; the rest stand alone.
const SOCIAL_CHANNELS: StyleChannel[] = ["social_carousel", "social_post"];
const STANDALONE_CHANNELS: StyleChannel[] = ["blog", "website", "newsletter"];

export default function ImageStylePage() {
  const [style, setStyle] = useState<ImageStyleSettings | null>(null);
  const [channels, setChannels] = useState<ChannelNotes | null>(null);
  const [assets, setAssets] = useState<StyleAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash((cur) => (cur === msg ? null : cur)), 2500);
  }, []);

  const loadAssets = useCallback(async () => {
    const res = await fetch("/api/images/style/assets", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setAssets((json.assets ?? []) as StyleAsset[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/images/style", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/images/style/assets", { cache: "no-store" }).then((r) =>
        r.json(),
      ),
    ])
      .then(([styleData, assetData]) => {
        if (cancelled) return;
        if (styleData.error) {
          setError(styleData.error);
        } else {
          setStyle(styleData.style as ImageStyleSettings);
          setChannels(styleData.channels as ChannelNotes);
        }
        if (!assetData.error) setAssets((assetData.assets ?? []) as StyleAsset[]);
      })
      .catch((e) =>
        !cancelled && setError(e instanceof Error ? e.message : "load failed"),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveGeneral() {
    if (!style) return;
    setSavingGeneral(true);
    setError(null);
    try {
      const res = await fetch("/api/images/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "save failed");
      setStyle(json.style as ImageStyleSettings);
      setChannels(json.channels as ChannelNotes);
      flash("General guide saved ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingGeneral(false);
    }
  }

  async function saveChannel(channel: StyleChannel) {
    if (!channels) return;
    setError(null);
    try {
      const res = await fetch("/api/images/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, notes: channels[channel] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "save failed");
      setChannels(json.channels as ChannelNotes);
      flash(`${CHANNEL_LABELS[channel]} saved ✓`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function uploadAssets(channel: StyleChannel, files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const form = new FormData();
    form.append("channel", channel);
    Array.from(files).forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/images/style/assets", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "upload failed");
      if (Array.isArray(json.failures) && json.failures.length > 0) {
        setError(
          json.failures
            .map((f: { filename: string; error: string }) => `${f.filename}: ${f.error}`)
            .join("; "),
        );
      }
      await loadAssets();
      flash("References uploaded ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    }
  }

  async function deleteAsset(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/images/style/assets/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "delete failed");
      }
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  function ChannelCard({ channel }: { channel: StyleChannel }) {
    if (!channels) return null;
    const channelAssets = assets.filter((a) => a.channel === channel);
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          {CHANNEL_LABELS[channel]}
        </h3>
        <textarea
          rows={3}
          value={channels[channel]}
          onChange={(e) =>
            setChannels((prev) =>
              prev ? { ...prev, [channel]: e.target.value } : prev,
            )
          }
          placeholder={CHANNEL_PLACEHOLDERS[channel]}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">
              Design references
            </span>
            <label className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  uploadAssets(channel, e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Uploaded examples are fed to the image model as visual references
            when this channel is selected (up to 4 used per generation).
          </p>

          {channelAssets.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {channelAssets.map((a) => (
                <figure
                  key={a.id}
                  className="group relative overflow-hidden rounded-md border border-slate-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.public_url}
                    alt={a.filename ?? "design reference"}
                    className="block aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    onClick={() => deleteAsset(a.id)}
                    title="Delete reference"
                    className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-red-700 opacity-0 shadow-sm transition group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => saveChannel(channel)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
          >
            Save notes
          </button>
        </div>
      </div>
    );
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
          The <strong>General guide</strong> applies to every image. Each channel
          below layers its own notes and uploaded design references on top. Pick a
          channel on{" "}
          <Link
            className="text-violet-700 underline-offset-2 hover:underline"
            href="/content/images"
          >
            /content/images
          </Link>{" "}
          to apply its style (the toggle there bypasses all of this for one-off
          prompts).
        </p>
      </header>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {savedFlash && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {savedFlash}
        </div>
      )}

      {style && channels && (
        <div className="space-y-8">
          {/* General guide */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
              General guide
            </h2>
            <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              {IMAGE_STYLE_KEYS.map((key) => (
                <div key={key}>
                  <label
                    htmlFor={key}
                    className="block text-sm font-semibold text-slate-800"
                  >
                    {FIELD_LABELS[key]}
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {FIELD_HINTS[key]}
                  </p>
                  <textarea
                    id={key}
                    rows={key === "avoidList" ? 3 : 4}
                    value={style[key]}
                    onChange={(e) =>
                      setStyle((prev) =>
                        prev ? { ...prev, [key]: e.target.value } : prev,
                      )
                    }
                    placeholder={FIELD_PLACEHOLDERS[key]}
                    className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                </div>
              ))}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={saveGeneral}
                  disabled={savingGeneral}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingGeneral ? "Saving…" : "Save general guide"}
                </button>
              </div>
            </div>
          </section>

          {/* Social media — two subsections */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
              Social media
            </h2>
            <div className="space-y-4">
              {SOCIAL_CHANNELS.map((c) => (
                <ChannelCard key={c} channel={c} />
              ))}
            </div>
          </section>

          {/* Remaining channels */}
          {STANDALONE_CHANNELS.map((c) => (
            <section key={c}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700">
                {CHANNEL_LABELS[c]}
              </h2>
              <ChannelCard channel={c} />
            </section>
          ))}

          <div className="flex">
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
