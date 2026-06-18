/**
 * Duplicate content — the side-by-side conflict view linked from the Overview
 * "Issues to fix" alert. Lists each duplicate GROUP (items in one table that
 * collapse to the same registry semantic key) with its members next to each
 * other, so the user can compare and decide which to keep before publishing.
 *
 * Server component: computes directly via listContentDuplicates() in the authed
 * render (real tenant), no client fetch.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { listContentDuplicates, type DuplicateGroup } from "@/lib/content-dedup";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Duplicate content | ${APP_NAME}`,
};

function statusTone(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "published") return "bg-emerald-50 text-emerald-700";
  if (s === "approved" || s === "review") return "bg-blue-50 text-blue-700";
  if (s === "needs_legal") return "bg-amber-50 text-amber-700";
  if (s === "rejected" || s === "archived") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-600";
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function DuplicatesPage() {
  let groups: DuplicateGroup[] = [];
  try {
    const tenantId = await resolveTenantId();
    groups = await listContentDuplicates(tenantId);
  } catch {
    groups = [];
  }

  const redundant = groups.reduce((n, g) => n + (g.members.length - 1), 0);

  return (
    <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Duplicate content</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {groups.length === 0
              ? "No overlapping content found — nothing to review."
              : `${groups.length} overlapping group${groups.length === 1 ? "" : "s"} · ${redundant} redundant item${redundant === 1 ? "" : "s"}. Review before publishing to avoid cannibalization.`}
          </p>
        </div>
        <Link
          href="/content-production"
          className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
        >
          ← Production Board
        </Link>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-400">
          No duplicates detected.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => (
            <section key={`${g.table}-${g.key}-${i}`} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {g.source}
                </span>
                <h2 className="text-sm font-semibold text-slate-900">“{g.key}”</h2>
                <span className="text-xs text-slate-400">· {g.members.length} items share this target</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.members.map((m) => (
                  <div key={m.id} className="flex flex-col rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="line-clamp-2 text-sm font-medium text-slate-800">{m.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(m.status)}`}>
                        {m.status ?? "—"}
                      </span>
                      {m.createdAt && <span className="text-[10px] text-slate-400">{fmtDate(m.createdAt)}</span>}
                    </div>
                    {m.href && (
                      <Link
                        href={m.href}
                        className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
                      >
                        View →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
