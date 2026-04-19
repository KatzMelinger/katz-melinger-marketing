"use client";

import { useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

type LocalPayload = {
  connected: boolean;
  error?: string;
  listing: {
    rating: number;
    reviewsCount: number;
    photosCount: number;
    postsCount: number;
  };
  reviews: {
    id: string;
    author: string;
    rating: number;
    comment: string;
    date: string;
  }[];
  rankings: { keyword: string; currentPosition: number; previousPosition: number }[];
  citations: { directory: string; consistency: "good" | "warning" | "critical" }[];
  competitors: { name: string; avgRating: number; reviewCount: number }[];
};

function citationTone(consistency: "good" | "warning" | "critical"): string {
  if (consistency === "good") return "text-emerald-300";
  if (consistency === "warning") return "text-amber-300";
  return "text-rose-300";
}

export default function LocalSeoPage() {
  const [data, setData] = useState<LocalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/local/gbp", { cache: "no-store" });
        const json = (await res.json()) as LocalPayload;
        if (cancelled) return;
        setData(json);
        setError(json.error ?? null);
      } catch {
        if (!cancelled) setError("Failed to load local SEO dashboard");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Local SEO Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Google Business Profile management, review workflows, and local
            visibility tracking.
          </p>
        </div>

        {error ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
          >
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Rating", value: (data?.listing.rating ?? 0).toFixed(1), bg: ACCENT },
            {
              label: "Reviews",
              value: (data?.listing.reviewsCount ?? 0).toLocaleString(),
              bg: "#166534",
            },
            {
              label: "Photos",
              value: (data?.listing.photosCount ?? 0).toLocaleString(),
              bg: "#b45309",
            },
            {
              label: "Posts",
              value: (data?.listing.postsCount ?? 0).toLocaleString(),
              bg: "#475569",
            },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-xl border border-white/5 p-5"
              style={{ backgroundColor: card.bg }}
            >
              <p className="text-sm text-white/90">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
            </article>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Recent reviews</h2>
            <div className="space-y-3">
              {(data?.reviews ?? []).map((review) => (
                <article
                  key={review.id}
                  className="rounded-lg border border-[#2a3f5f] p-4 text-sm"
                >
                  <p className="font-semibold text-white">
                    {review.author} · {review.rating}/5
                  </p>
                  <p className="mt-1 text-slate-300">{review.comment}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>{new Date(review.date).toLocaleDateString()}</span>
                    <button
                      type="button"
                      className="rounded-md bg-[#185FA5] px-2.5 py-1 text-white"
                    >
                      Draft response
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Local ranking tracking</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3f5f] text-slate-400">
                    <th className="pb-3 pr-4 font-medium">Keyword</th>
                    <th className="pb-3 pr-4 font-medium">Current</th>
                    <th className="pb-3 font-medium">Previous</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {(data?.rankings ?? []).map((row) => (
                    <tr key={row.keyword} className="border-b border-[#2a3f5f]/60">
                      <td className="py-2 pr-4 text-white">{row.keyword}</td>
                      <td className="py-2 pr-4 tabular-nums">#{row.currentPosition}</td>
                      <td className="py-2 tabular-nums">#{row.previousPosition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Citation management</h2>
            <div className="space-y-3 text-sm">
              {(data?.citations ?? []).map((citation) => (
                <div
                  key={citation.directory}
                  className="flex items-center justify-between rounded-lg border border-[#2a3f5f] px-4 py-3"
                >
                  <span className="text-white">{citation.directory}</span>
                  <span className={`font-semibold capitalize ${citationTone(citation.consistency)}`}>
                    {citation.consistency}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Local competitor analysis</h2>
            <div className="space-y-3 text-sm">
              {(data?.competitors ?? []).map((row) => (
                <div
                  key={row.name}
                  className="rounded-lg border border-[#2a3f5f] px-4 py-3"
                >
                  <p className="font-semibold text-white">{row.name}</p>
                  <p className="mt-1 text-slate-300">
                    Rating {row.avgRating.toFixed(1)} · Reviews {row.reviewCount}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section
          className="rounded-xl border border-dashed p-6"
          style={{ backgroundColor: CARD, borderColor: "#185FA5" }}
        >
          <h2 className="text-lg font-semibold text-white">Review request automation</h2>
          <p className="mt-2 text-sm text-slate-300">
            Trigger post-case review requests via SMS/email after matters close.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" className="rounded-md bg-[#185FA5] px-3 py-2 text-sm text-white">
              Create request template
            </button>
            <button
              type="button"
              className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-200"
            >
              Connect automation workflow
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
