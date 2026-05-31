"use client";

/**
 * Microsoft Clarity launcher.
 *
 * Clarity has no public API for heatmaps / recordings data — everything lives
 * in their dashboard. So this page is a curated launcher: when CLARITY_PROJECT_ID
 * is set, it surfaces the most useful Clarity views as one-click deep links.
 * When unset, it shows the setup steps.
 *
 * The Project ID is not a secret (it's already in the public tracking script
 * embedded on katzmelinger.com), so it's safe to render in the URL.
 */

import { useEffect, useState } from "react";


type Status = { configured: boolean; projectId: string };

const QUICK_LINKS = [
  {
    title: "Dashboard",
    description:
      "Overview of all Clarity metrics, top insights, and site performance summary.",
    icon: "▣",
    path: "/dashboard",
  },
  {
    title: "Heatmaps",
    description:
      "See where users click, scroll, and move their mouse on each page.",
    icon: "🔥",
    path: "/heatmaps",
  },
  {
    title: "Session recordings",
    description:
      "Watch real user sessions to understand behavior and identify issues.",
    icon: "▶",
    path: "/recordings",
  },
  {
    title: "User insights",
    description:
      "Understand audience demographics, devices, and engagement patterns.",
    icon: "👥",
    path: "/insights",
  },
  {
    title: "Dead clicks",
    description:
      "Elements users click that don't respond — fix UX frustrations.",
    icon: "🖱",
    path: "/dashboard?filter=deadClicks",
  },
  {
    title: "Rage clicks",
    description: "Areas where users click repeatedly in frustration.",
    icon: "⚡",
    path: "/dashboard?filter=rageClicks",
  },
];

const DEVICE_LINKS = [
  { label: "Desktop", path: "/dashboard?device=Desktop" },
  { label: "Mobile", path: "/dashboard?device=Mobile" },
  { label: "All devices", path: "/dashboard" },
];

const KEY_PAGES = [
  { label: "Homepage", page: "/" },
  { label: "Contact", page: "/contact" },
  { label: "Practice Areas", page: "/practice-areas" },
  { label: "About", page: "/about" },
];

export default function ClarityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/clarity/status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-4 py-12 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Microsoft Clarity</h1>
            <p className="text-sm text-slate-600 mt-1">
              Heatmaps, session recordings & user behavior analytics.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border border-amber-200 bg-amber-50 text-amber-800">
            ● Not connected
          </span>
        </div>

        <div className="border border-slate-200 rounded-xl p-8 bg-white">
          <div className="text-3xl mb-3" aria-hidden>
            🔍
          </div>
          <h2 className="text-lg font-semibold">Connect Microsoft Clarity</h2>
          <p className="text-sm text-slate-600 mt-2 max-w-lg">
            Microsoft Clarity is free and gives you heatmaps, session
            recordings, dead-click detection, and rage-click analysis for your
            website. Two steps:
          </p>

          <ol className="mt-5 list-decimal pl-5 space-y-3 text-sm text-slate-700">
            <li>
              <span className="font-medium">Create a Clarity project</span> at{" "}
              <a
                href="https://clarity.microsoft.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#185FA5] hover:underline"
              >
                clarity.microsoft.com
              </a>
              {" "}— sign in with a Microsoft account, add{" "}
              <span className="font-mono">katzmelinger.com</span> as the site,
              and copy the tracking script Clarity provides into your website's{" "}
              <span className="font-mono">&lt;head&gt;</span>.
            </li>
            <li>
              <span className="font-medium">Find the Project ID</span>: in
              Clarity, go to <span className="font-mono">Settings → Overview → Project ID</span>.
              It looks like a short alphanumeric string (no secret — it's
              embedded in the public tracking script).
            </li>
            <li>
              <span className="font-medium">Add to Vercel env vars</span>:{" "}
              <code className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs">
                CLARITY_PROJECT_ID
              </code>{" "}
              = the value from step 2. Redeploy. Reload this page.
            </li>
          </ol>

          <p className="text-xs text-slate-500 mt-6">
            Clarity has no public API for the heatmap or recording data — they
            live only in Clarity's UI, which this page deep-links into.
          </p>
        </div>
      </div>
    );
  }

  const base = `https://clarity.microsoft.com/projects/view/${status.projectId}`;

  return (
    <>
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Microsoft Clarity</h1>
          <p className="text-sm text-slate-600 mt-1">
            Heatmaps, session recordings & user behavior analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${base}/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            ↗ Open in Clarity
          </a>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border border-emerald-200 bg-emerald-50 text-emerald-700">
            ● Connected
          </span>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-5 bg-white mb-6">
        <h3 className="text-sm font-semibold mb-1">Project connected</h3>
        <p className="text-sm text-slate-600">
          Clarity project{" "}
          <span className="font-mono text-[#185FA5]">{status.projectId}</span>{" "}
          is tracking user behavior on katzmelinger.com. Clarity opens in a new
          tab for full access to heatmaps, recordings, and analytics.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {DEVICE_LINKS.map((d) => (
            <a
              key={d.label}
              href={base + d.path}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
            >
              {d.label}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {QUICK_LINKS.map((link) => (
          <a
            key={link.title}
            href={base + link.path}
            target="_blank"
            rel="noopener noreferrer"
            className="group border border-slate-200 rounded-xl p-5 bg-white hover:border-[#185FA5]/40 transition-colors block"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-2xl" aria-hidden>
                {link.icon}
              </span>
              <span className="text-slate-400 group-hover:text-[#185FA5]" aria-hidden>
                ↗
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{link.title}</h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{link.description}</p>
          </a>
        ))}
      </div>

      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h3 className="text-sm font-semibold mb-3">Key pages to analyze</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {KEY_PAGES.map((p) => (
            <a
              key={p.label}
              href={`${base}/heatmaps?url=https://katzmelinger.com${p.page}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-3 py-2 rounded-md border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5] flex items-center justify-between"
            >
              <span>{p.label}</span>
              <span className="text-xs text-slate-400">↗</span>
            </a>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500 text-center mt-6">
        Microsoft Clarity opens in a new tab. Make sure you're signed in to
        your Microsoft account to access the project.
      </p>
    </div>
    </>
  );
}
