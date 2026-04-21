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
  useEffect(() => {
    console.error("SEO route error:", error);
  }, [error]);

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold">SEO page failed to render</h1>
        <p className="text-sm text-slate-300">
          This route deployed correctly but threw while rendering. Most often this is an upstream
          data source (for example Semrush) rejecting the request.
        </p>
        <pre className="overflow-x-auto rounded-md border border-[#2a3f5f] bg-[#1a2540] p-4 text-xs text-amber-200">
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
            className="rounded border border-[#2a3f5f] bg-[#1a2540] px-3 py-1.5 text-sm text-slate-200"
          >
            Back to SEO overview
          </Link>
        </div>
      </main>
    </div>
  );
}
