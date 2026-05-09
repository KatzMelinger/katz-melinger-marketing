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
            className="rounded bg-[#185FA5] px-3 py-1.5 text-sm font-medium text-slate-900"
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
