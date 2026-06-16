"use client";

/**
 * Editorial content pipeline.
 *
 * Tracks each piece of content as it moves through Idea → Brief → Draft →
 * Review → Published, with bucket categorization (Money Page, BOFU
 * Education, MOFU Trust, Local Authority) for content-mix balance.
 *
 * Distinct from /content/drafts (which is the auto-saved text from AI
 * generations). The pipeline is a planning tool; drafts are the artifacts.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import { DraftDrawer } from "@/components/draft-drawer";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";
import { CONTENT_TYPE_LABEL, readContentType } from "@/lib/content-types";

type Status = "idea" | "brief" | "draft" | "review" | "published";
type Bucket = "money_page" | "bofu_education" | "mofu_trust" | "local_authority";

type Item = {
  id: number;
  title: string;
  keywords: string | null;
  location: string | null;
  status: Status;
  bucket: Bucket;
  notes: string | null;
  url: string | null;
  draft_id: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  status_updated_at: string;
  created_at: string;
  updated_at: string;
};

type AppUser = { id: string; email: string };

/**
 * Renders the status-update date as a short, friendly string. < 24h shows
 * "today" / "Nh ago" so reviewers can spot stale items; older items show the
 * date so dates don't drift into useless "47d ago".
 */
function formatStatusDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const ms = now - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Stats = {
  total: number;
  byStatus: Record<string, number>;
  byBucket: Record<string, number>;
};

const STATUS_LABEL: Record<Status, string> = {
  idea: "Idea",
  brief: "Brief",
  draft: "Draft",
  review: "Review",
  published: "Published",
};

const STATUS_TONE: Record<Status, "violet" | "blue" | "amber" | "neutral" | "emerald"> = {
  idea: "violet",
  brief: "blue",
  draft: "amber",
  review: "neutral",
  published: "emerald",
};

const BUCKET_LABEL: Record<Bucket, string> = {
  money_page: "Money Page",
  bofu_education: "BOFU Education",
  mofu_trust: "MOFU Trust",
  local_authority: "Local Authority",
};

const STATUSES: Status[] = ["idea", "brief", "draft", "review", "published"];
const BUCKETS: Bucket[] = ["money_page", "bofu_education", "mofu_trust", "local_authority"];

export default function PipelinePage() {
  const searchParams = useSearchParams();
  const contentType = readContentType(searchParams);

  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<string>("all");
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  // The item currently open in the inline Review draft view (read/edit/approve
  // without leaving the board). Null = closed.
  const [reviewItem, setReviewItem] = useState<Item | null>(null);
  // Pipeline row currently generating a draft (so we can show "Generating…").
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  // Fetch the team list once — used by the owner picker in each row + the
  // ContentModal. Failing silently is fine: the picker just shows "Unassigned".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUsers(data.users ?? []);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (bucketFilter !== "all") params.set("bucket", bucketFilter);
    params.set("content_type", contentType);
    try {
      const res = await fetch(`/api/content/pipeline?${params.toString()}`);
      const data = await res.json();
      setItems(data.items ?? []);
      setStats(data.stats ?? null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, bucketFilter, contentType]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setStatus = async (id: number, status: Status) => {
    await fetch(`/api/content/pipeline/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  };

  const setOwner = async (id: number, ownerUserId: string | null) => {
    // Optimistic — patch the list locally so the dropdown closes against
    // the new value immediately. refresh() reconciles with the server.
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              owner_user_id: ownerUserId,
              owner_email: ownerUserId
                ? (users.find((u) => u.id === ownerUserId)?.email ?? null)
                : null,
            }
          : it,
      ),
    );
    await fetch(`/api/content/pipeline/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerUserId }),
    });
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this content item?")) return;
    await fetch(`/api/content/pipeline/${id}`, { method: "DELETE" });
    refresh();
  };

  // Open the full Review draft view inline. Any item with a draft uses this.
  const openDraft = (item: Item) => {
    if (!item.draft_id) return;
    setReviewItem(item);
  };

  // A Draft-status item with no draft yet: generate one (with the same
  // internal-link + auto-readability pipeline as every other generation),
  // link it to this row, then open it inline. This is what guarantees every
  // Draft item has a working draft to view — "no exceptions".
  const generateDraft = async (item: Item) => {
    setGeneratingId(item.id);
    try {
      const draftContentType =
        contentType === "website" ? "blog" : contentType; // social | email pass through
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: draftContentType,
          topic: item.title,
          target_keywords: item.keywords
            ? item.keywords.split(",").map((k) => k.trim()).filter(Boolean)
            : [],
        }),
      });
      const data = await res.json();
      if (res.ok && data.draft_id) {
        await fetch(`/api/content/pipeline/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: data.draft_id }),
        });
        setReviewItem({ ...item, draft_id: data.draft_id });
        refresh();
      } else {
        alert(data?.error ?? "Draft generation failed.");
      }
    } catch {
      alert("Draft generation failed.");
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <Link
        href="/content-production"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        <span aria-hidden>←</span> Production Board
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
          <p className="text-sm text-slate-600 mt-1">
            Editorial pipeline from idea to published —{" "}
            <span className="font-medium">{CONTENT_TYPE_LABEL[contentType]}</span>.
          </p>
        </div>
        <DashButton
          onClick={() => {
            setEditingItem(null);
            setShowModal(true);
          }}
        >
          + New content
        </DashButton>
      </div>
      <ContentTypeTabs />
      <ContentNav />

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <DashSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </DashSelect>
        <DashSelect value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
          <option value="all">All buckets</option>
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {BUCKET_LABEL[b]}
            </option>
          ))}
        </DashSelect>

        {stats && (
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {STATUSES.map((s) => {
              const n = stats.byStatus[s] ?? 0;
              if (n === 0) return null;
              return (
                <DashPill key={s} tone={STATUS_TONE[s]}>
                  {STATUS_LABEL[s]}: {n}
                </DashPill>
              );
            })}
          </div>
        )}
      </div>

      {loading && items.length === 0 ? (
        <DashCard className="text-center py-12 text-sm text-slate-500">
          <DashSpinner /> Loading pipeline…
        </DashCard>
      ) : items.length === 0 ? (
        <DashCard className="text-center py-12 space-y-3">
          <div className="text-3xl" aria-hidden>
            📝
          </div>
          <h3 className="text-lg font-semibold">No content yet</h3>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Start building your editorial pipeline. Add titles, keywords, target
            locations, and move them through Idea → Brief → Draft → Review →
            Published.
          </p>
          <div>
            <DashButton
              onClick={() => {
                setEditingItem(null);
                setShowModal(true);
              }}
            >
              + New content
            </DashButton>
          </div>
        </DashCard>
      ) : (
        <DashCard padding="p-0" className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Title & details</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 w-[180px]">Status</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 w-[180px]">Owner</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 w-[140px]">Bucket</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-slate-500 w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-900">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-brand hover:underline">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {item.keywords && (
                        <span className="text-xs text-slate-500">
                          Kw: <span className="text-slate-700">{item.keywords}</span>
                        </span>
                      )}
                      {item.location && (
                        <span className="text-xs text-slate-500">
                          Loc: <span className="text-slate-700">{item.location}</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusDropdown
                      current={item.status}
                      onChange={(s) => setStatus(item.id, s)}
                    />
                    <div
                      className="text-[10px] text-slate-500 mt-1"
                      title={new Date(item.status_updated_at).toLocaleString()}
                    >
                      {formatStatusDate(item.status_updated_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <OwnerPicker
                      currentId={item.owner_user_id}
                      currentEmail={item.owner_email}
                      users={users}
                      onChange={(id) => setOwner(item.id, id)}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{BUCKET_LABEL[item.bucket]}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {item.draft_id ? (
                      <button
                        onClick={() => openDraft(item)}
                        className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        title="Open the full review page — metadata, draft, internal links, QA, and approve — right here on the board"
                      >
                        Review draft
                      </button>
                    ) : item.status === "draft" ? (
                      <button
                        onClick={() => generateDraft(item)}
                        disabled={generatingId === item.id}
                        className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        title="This item is at Draft but has no draft yet — generate one and open it"
                      >
                        {generatingId === item.id ? "Generating…" : "Generate draft"}
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        setEditingItem(item);
                        setShowModal(true);
                      }}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-brand hover:text-brand"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashCard>
      )}

      {reviewItem && (
        <DraftDrawer
          item={reviewItem}
          onClose={() => setReviewItem(null)}
          onChanged={refresh}
          onEditMeta={() => {
            setEditingItem(reviewItem);
            setShowModal(true);
          }}
        />
      )}

      {/* Rendered last so the metadata form layers above the review view when
          "Edit all fields" is used. */}
      {showModal && (
        <ContentModal
          item={editingItem}
          contentType={contentType}
          users={users}
          onClose={() => {
            setShowModal(false);
            setEditingItem(null);
          }}
          onSaved={() => {
            setShowModal(false);
            setEditingItem(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function OwnerPicker({
  currentId,
  currentEmail,
  users,
  onChange,
}: {
  currentId: string | null;
  currentEmail: string | null;
  users: AppUser[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // Show a name-ish label (local part of the email) when assigned, "Unassigned"
  // otherwise. Hover reveals the full email via title attribute.
  const label = currentEmail
    ? currentEmail.split("@")[0]
    : "Unassigned";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={currentEmail ?? "No owner assigned"}
        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
          currentId
            ? "border-slate-300 text-slate-700 hover:border-brand"
            : "border-dashed border-slate-300 text-slate-500 hover:border-brand hover:text-brand"
        }`}
      >
        {currentId && (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand text-white text-[9px] font-semibold"
            aria-hidden
          >
            {label.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate max-w-[120px]">{label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-40 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[200px] max-h-[280px] overflow-auto">
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${
                !currentId ? "font-semibold text-brand" : "text-slate-700"
              }`}
            >
              Unassigned{!currentId ? " ✓" : ""}
            </button>
            {users.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-slate-500 italic">
                No teammates found.
              </p>
            ) : (
              users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${
                    u.id === currentId ? "font-semibold text-brand" : "text-slate-700"
                  }`}
                  title={u.email}
                >
                  {u.email}
                  {u.id === currentId ? " ✓" : ""}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatusDropdown({
  current,
  onChange,
}: {
  current: Status;
  onChange: (s: Status) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center"
      >
        <DashPill tone={STATUS_TONE[current]}>
          {STATUS_LABEL[current]} ▾
        </DashPill>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-40 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[140px]">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${
                  s === current ? "font-semibold text-brand" : "text-slate-700"
                }`}
              >
                {STATUS_LABEL[s]}
                {s === current ? " ✓" : ""}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ContentModal({
  item,
  contentType,
  users,
  onClose,
  onSaved,
}: {
  item: Item | null;
  contentType: "website" | "social" | "email";
  users: AppUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [title, setTitle] = useState(item?.title ?? "");
  const [keywords, setKeywords] = useState(item?.keywords ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [status, setStatus] = useState<Status>((item?.status as Status) ?? "idea");
  const [bucket, setBucket] = useState<Bucket>((item?.bucket as Bucket) ?? "bofu_education");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(
    item?.owner_user_id ?? null,
  );
  const [url, setUrl] = useState(item?.url ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        keywords,
        location,
        status,
        bucket,
        url,
        notes,
        ownerUserId,
        // New items inherit the active top-tab; edits preserve existing type.
        ...(isEdit ? {} : { contentType }),
      };
      const url2 = isEdit ? `/api/content/pipeline/${item!.id}` : "/api/content/pipeline";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url2, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error ?? "Save failed");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl p-6 space-y-4 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl"
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="text-lg font-semibold">{isEdit ? "Edit content" : "New content"}</h2>

        <div>
          <label className="text-xs font-medium text-slate-700">Title</label>
          <DashInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. NYC Employment Discrimination Lawyer"
            className="w-full mt-1"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-700">Keywords</label>
            <DashInput
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="employment discrimination"
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Location</label>
            <DashInput
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="New York City"
              className="w-full mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-700">Status</label>
            <DashSelect
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="w-full mt-1"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </DashSelect>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Bucket</label>
            <DashSelect
              value={bucket}
              onChange={(e) => setBucket(e.target.value as Bucket)}
              className="w-full mt-1"
            >
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABEL[b]}
                </option>
              ))}
            </DashSelect>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">Owner (optional)</label>
          <DashSelect
            value={ownerUserId ?? ""}
            onChange={(e) =>
              setOwnerUserId(e.target.value === "" ? null : e.target.value)
            }
            className="w-full mt-1"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </DashSelect>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">URL (optional)</label>
          <DashInput
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourfirm.com/…"
            className="w-full mt-1"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <DashButton variant="outline" onClick={onClose}>
            Cancel
          </DashButton>
          <DashButton onClick={submit} disabled={saving}>
            {saving ? <DashSpinner /> : isEdit ? "Save changes" : "Create"}
          </DashButton>
        </div>
      </div>
    </div>
  );
}
