"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SeoRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A ChunkLoadError means the browser is holding HTML from an older
  // deployment and tried to fetch a JS chunk that the current deployment
  // rotated out (content-hashed filenames change every build). It is NOT a
  // data/Semrush failure. Recover by hard-reloading once — guarded by a
  // sessionStorage flag so a genuinely-missing chunk can't loop forever.
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /Loading chunk|Failed to load chunk|Importing a module script failed/i.test(
      error.message,
    );

  useEffect(() => {
    console.error("SEO route error:", error);
    if (!isChunkError || typeof window === "undefined") return;
    // Only auto-reload if we haven't already done so in the last 10s. This
    // breaks an infinite loop if a chunk is genuinely gone, but still lets a
    // later deploy auto-recover instead of being suppressed forever.
    const KEY = "seo-chunk-reloaded-at";
    const last = Number(sessionStorage.getItem(KEY) ?? "0");
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    }
  }, [error, isChunkError]);

  if (isChunkError) {
    return (
      <div
        className="min-h-screen text-slate-900"
        style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-semibold">Updating to the latest version…</h1>
          <p className="text-sm text-slate-600">
            A new version was just deployed. Reloading to pick it up. If this page doesn&apos;t
            refresh on its own, hard-reload with Ctrl+Shift+R.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-[#185FA5] px-3 py-1.5 text-sm font-medium text-white"
            >
              Reload now
            </button>
            <Link
              href="/seo"
              className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-1.5 text-sm text-slate-700"
            >
              Back to SEO overview
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold">SEO page failed to render</h1>
        <p className="text-sm text-slate-600">
          This route deployed correctly but threw while rendering. Most often this is an upstream
          data source (for example Semrush) rejecting the request.
        </p>
        <pre className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-[#ffffff] p-4 text-xs text-amber-700">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded bg-[#185FA5] px-3 py-1.5 text-sm font-medium text-white"
          >
            Try again
          </button>
          <Link
            href="/seo"
            className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-1.5 text-sm text-slate-700"
          >
            Back to SEO overview
          </Link>
        </div>
      </main>
    </div>
  );
}
