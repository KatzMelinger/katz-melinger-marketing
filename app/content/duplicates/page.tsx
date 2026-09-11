"use client";

/**
 * Duplicate cleanup — one draft per topic (Diana's item 20).
 *
 * Content Studio already holds duplicate drafts: two pregnancy discrimination
 * sets minutes apart, and others. Item 7 stops new ones arriving; the ones
 * already there still need clearing, and until now the only thing that knew
 * about them was a count on the Overview alert with nowhere to go.
 *
 * The detection is not new — lib/content-dedup.ts has grouped by semantic key
 * (synonym- and word-order-invariant) since it was written for the creation
 * guard. This is the view over it plus the action.
 *
 * SUGGESTED, NOT SELECTED
 *
 * Each group arrives with a suggested keeper — furthest along the pipeline,
 * then most recent — and the user can pick a different one before acting. That
 * ordering matters more than it looks: of two copies, the one already reviewed
 * and approved carries work the fresher duplicate does not, so "keep the newest"
 * would routinely throw away the better row.
 *
 * Nothing is deleted. See the resolve route for why archiving is the right
 * asymmetry when the grouping is a heuristic.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";
import type { DuplicateGroup } from "@/lib/content-dedup";

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** Per-group override of the suggested keeper, keyed by group key. */
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/content/duplicates?detail=1", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groupId = (g: DuplicateGroup) => `${g.table}::${g.key}`;

  const resolve = async (g: DuplicateGroup) => {
    const id = groupId(g);
    const keepId = chosen[id] ?? g.suggestedKeeperId ?? g.members[0]?.id;
    if (!keepId) return;
    const archiveIds = g.members.map((m) => m.id).filter((mid) => mid !== keepId);
    if (archiveIds.length === 0) return;

    const keeper = g.members.find((m) => m.id === keepId);
    const ok = window.confirm(
      `Keep "${keeper?.title ?? keepId}" and archive the other ${archiveIds.length}?\n\n` +
        `Archived items stay in the database and can be restored — nothing is deleted.`,
    );
    if (!ok) return;

    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch("/api/content/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: g.table, keepId, archiveIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Couldn't clear that group.");
        return;
      }
      // Re-scan rather than removing the row locally: archiving can dissolve a
      // group entirely or leave a smaller one, and guessing which would show a
      // board that disagrees with the database.
      await load();
    } finally {
      setBusy(null);
    }
  };

  const redundant = groups.reduce((n, g) => n + Math.max(0, g.members.length - 1), 0);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Duplicate cleanup</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Items in the same table targeting the same topic. Keep one, archive the rest. Grouping
          ignores word order and abbreviations, so “labor attorney NY” and “NY labor attorney” are
          one group.
        </p>
      </div>

      {loading ? (
        <DashCard>
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <DashSpinner /> Scanning for duplicates…
          </div>
        </DashCard>
      ) : groups.length === 0 ? (
        <DashCard>
          <p className="p-4 text-sm text-emerald-700">
            No duplicates found. One item per topic in every table.
          </p>
        </DashCard>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {groups.length} group{groups.length === 1 ? "" : "s"} · {redundant} redundant item
            {redundant === 1 ? "" : "s"}
          </p>

          {msg && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {msg}
            </p>
          )}

          <div className="space-y-3">
            {groups.map((g) => {
              const id = groupId(g);
              const keepId = chosen[id] ?? g.suggestedKeeperId ?? g.members[0]?.id;
              return (
                <DashCard key={id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-900">{g.key}</span>
                      <span className="ml-2"><DashPill tone="blue">{g.source}</DashPill></span>
                      <span className="ml-2 text-xs text-slate-500">
                        {g.members.length} copies
                      </span>
                    </div>
                    <DashButton
                      onClick={() => void resolve(g)}
                      disabled={busy === id || g.members.length < 2}
                    >
                      {busy === id ? "Working…" : `Keep 1, archive ${g.members.length - 1}`}
                    </DashButton>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {g.members.map((m) => {
                      const isKeeper = m.id === keepId;
                      return (
                        <li
                          key={m.id}
                          className={`flex flex-wrap items-center gap-2 px-4 py-2 text-xs ${
                            isKeeper ? "bg-emerald-50/60" : ""
                          }`}
                        >
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="radio"
                              name={`keep-${id}`}
                              checked={isKeeper}
                              onChange={() => setChosen((p) => ({ ...p, [id]: m.id }))}
                              className="h-3 w-3 cursor-pointer accent-emerald-600"
                            />
                            <span className={isKeeper ? "font-medium text-slate-900" : "text-slate-600"}>
                              {m.title}
                            </span>
                          </label>
                          {m.status && <DashPill tone="neutral">{m.status}</DashPill>}
                          {m.createdAt && (
                            <span className="text-slate-400">
                              {new Date(m.createdAt).toLocaleDateString()}
                            </span>
                          )}
                          {isKeeper && (
                            <span className="font-medium text-emerald-700">keep</span>
                          )}
                          {m.href && (
                            <Link
                              href={m.href}
                              className="ml-auto text-brand underline hover:no-underline"
                            >
                              open
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </DashCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
