"use client";

/**
 * Review-generation workflow UI — the "Request Reviews" tab on /reviews.
 *
 * Flow: add recipients (manual or pasted CSV) → they land as `queued` → preview
 * the AI-drafted ask (editable, with an advisory compliance badge) → send →
 * watch the funnel (queued → sent → clicked → posted). Talks to
 * /api/reviews/requests for everything; no sentiment gating anywhere.
 */

import { useCallback, useEffect, useState } from "react";

type Channel = "email" | "sms";
type Status = "queued" | "sent" | "clicked" | "posted" | "failed";

type ReviewRequest = {
  id: string;
  recipient_name: string | null;
  recipient_contact: string;
  channel: Channel;
  practice_area: string | null;
  status: Status;
  subject: string | null;
  message: string | null;
  error: string | null;
  sent_at: string | null;
  clicked_at: string | null;
};

type Violation = { rule: string; severity: "high" | "medium" | "low"; reason?: string };
type Compliance = {
  score?: number;
  status?: string;
  violations?: Violation[];
  warnings?: string[];
  requiredDisclaimers?: string[];
} | null;

type MessagingStatus = Record<Channel, { provider: string; live: boolean }>;

const STATUS_ORDER: Status[] = ["queued", "sent", "clicked", "posted", "failed"];
const STATUS_STYLE: Record<Status, string> = {
  queued: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  clicked: "bg-amber-100 text-amber-700",
  posted: "bg-green-100 text-green-700",
  failed: "bg-rose-100 text-rose-700",
};

function highestSeverity(c: Compliance): "high" | "medium" | "low" | "none" {
  if (!c?.violations?.length) return "none";
  if (c.violations.some((v) => v.severity === "high")) return "high";
  if (c.violations.some((v) => v.severity === "medium")) return "medium";
  return "low";
}

/** name,contact[,channel][,practice_area] per line; header row optional. */
function parseCsv(text: string): Array<{
  recipient_name: string | null;
  recipient_contact: string;
  channel: Channel;
  practice_area: string | null;
}> {
  const out: ReturnType<typeof parseCsv> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim());
    const lower = cols.map((c) => c.toLowerCase());
    // Skip a header row.
    if (lower.includes("contact") || lower.includes("email") || lower.includes("phone")) {
      if (lower.some((c) => c === "contact" || c === "email" || c === "phone")) continue;
    }
    const [name, contact, channelRaw, practice] = cols;
    if (!contact) continue;
    const channel: Channel =
      channelRaw === "email" || channelRaw === "sms"
        ? channelRaw
        : contact.includes("@")
          ? "email"
          : "sms";
    out.push({
      recipient_name: name || null,
      recipient_contact: contact,
      channel,
      practice_area: practice || null,
    });
  }
  return out;
}

export function ReviewRequestsPanel() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [funnel, setFunnel] = useState<Record<Status, number> | null>(null);
  const [messaging, setMessaging] = useState<MessagingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [topError, setTopError] = useState<string | null>(null);

  // Manual add form.
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [practiceArea, setPracticeArea] = useState("");
  const [adding, setAdding] = useState(false);

  // CSV paste.
  const [csv, setCsv] = useState("");

  // Per-row preview/send state.
  const [draft, setDraft] = useState<
    Record<
      string,
      { subject: string; body: string; compliance: Compliance; open: boolean; busy: boolean }
    >
  >({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews/requests", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setTopError(json.error);
      setRequests(Array.isArray(json.requests) ? json.requests : []);
      setFunnel(json.funnel ?? null);
      setMessaging(json.messaging ?? null);
    } catch {
      setTopError("Network error loading review requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRecipients(
    recipients: Array<Record<string, unknown>>,
  ): Promise<void> {
    setTopError(null);
    const res = await fetch("/api/reviews/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", recipients }),
    });
    const json = await res.json();
    if (!res.ok) {
      setTopError(json.error ?? "Could not add recipients.");
      return;
    }
    await load();
  }

  async function handleManualAdd() {
    if (!contact.trim()) {
      setTopError("Enter an email or phone number.");
      return;
    }
    setAdding(true);
    await createRecipients([
      {
        recipient_name: name || null,
        recipient_contact: contact,
        channel,
        practice_area: practiceArea || null,
        source: "manual",
      },
    ]);
    setName("");
    setContact("");
    setPracticeArea("");
    setAdding(false);
  }

  async function handleCsvImport() {
    const parsed = parseCsv(csv);
    if (parsed.length === 0) {
      setTopError("No valid rows found. Use: name,contact,channel,practice_area");
      return;
    }
    await createRecipients(parsed.map((p) => ({ ...p, source: "csv" })));
    setCsv("");
  }

  async function handlePreview(id: string) {
    setDraft((d) => ({
      ...d,
      [id]: { subject: "", body: "", compliance: null, open: true, busy: true },
    }));
    try {
      const res = await fetch("/api/reviews/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTopError(json.error ?? "Preview failed.");
        setDraft((d) => ({ ...d, [id]: { ...d[id], busy: false } }));
        return;
      }
      setDraft((d) => ({
        ...d,
        [id]: {
          subject: json.subject ?? "",
          body: json.body ?? "",
          compliance: json.compliance ?? null,
          open: true,
          busy: false,
        },
      }));
    } catch {
      setTopError("Network error during preview.");
      setDraft((d) => ({ ...d, [id]: { ...d[id], busy: false } }));
    }
  }

  async function handleSend(id: string) {
    const d = draft[id];
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], busy: true } }));
    try {
      const res = await fetch("/api/reviews/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          id,
          message: d?.body || undefined,
          subject: d?.subject || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTopError(json.error ?? "Send failed.");
        setDraft((prev) => ({ ...prev, [id]: { ...prev[id], busy: false } }));
        return;
      }
      setDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch {
      setTopError("Network error during send.");
      setDraft((prev) => ({ ...prev, [id]: { ...prev[id], busy: false } }));
    }
  }

  const simulated = messaging
    ? (Object.keys(messaging) as Channel[]).filter((c) => !messaging[c].live)
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Request reviews</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ask past clients for an honest Google review. Everyone is sent to the
          same public review form — no pre-screening.
        </p>
      </div>

      {topError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {topError}
        </div>
      ) : null}

      {simulated.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Simulated send:</strong> {simulated.join(" & ")} ha
          {simulated.length > 1 ? "ve" : "s"} no provider key configured, so
          messages on {simulated.length > 1 ? "those channels" : "that channel"}{" "}
          are recorded as <em>sent</em> but not actually delivered. Set the
          provider env vars to go live.
        </div>
      ) : null}

      {/* Funnel */}
      {funnel ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STATUS_ORDER.map((s) => (
            <div
              key={s}
              className="rounded-lg border border-[#e2e8f0] p-4 text-center"
            >
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {funnel[s] ?? 0}
              </p>
              <p className="mt-1 text-xs font-medium capitalize text-slate-500">
                {s}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Add recipients */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Add one recipient</h3>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              placeholder={channel === "email" ? "client@example.com" : "+15551234567"}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
            <div className="flex gap-3">
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Practice area (optional)"
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
              />
            </div>
            <button
              onClick={handleManualAdd}
              disabled={adding}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#116AB2" }}
            >
              {adding ? "Adding…" : "Add to queue"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Paste CSV</h3>
          <p className="mt-1 text-xs text-slate-500">
            One per line: <code>name,contact,channel,practice_area</code>. Channel
            is inferred from the contact if omitted.
          </p>
          <textarea
            className="mt-3 h-28 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
            placeholder={"Jane Doe,jane@example.com,email,Wage & Hour\nJohn Roe,+15551234567,sms"}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <button
            onClick={handleCsvImport}
            className="mt-3 inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Import rows
          </button>
        </div>
      </section>

      {/* Requests table */}
      <section className="rounded-xl border border-[#e2e8f0] p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">
          Requests {requests.length > 0 ? `(${requests.length})` : ""}
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-slate-500">
            No requests yet. Add recipients above to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => {
              const d = draft[r.id];
              const sev = highestSeverity(d?.compliance ?? null);
              const canActOn = r.status === "queued" || r.status === "failed";
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-[#e2e8f0]"
                >
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    <span className="font-medium text-slate-900">
                      {r.recipient_name || r.recipient_contact}
                    </span>
                    <span className="text-xs text-slate-500">
                      {r.channel.toUpperCase()} · {r.recipient_contact}
                    </span>
                    {r.error ? (
                      <span className="text-xs text-rose-600">{r.error}</span>
                    ) : null}
                    <div className="ml-auto flex gap-2">
                      {canActOn ? (
                        <button
                          onClick={() => handlePreview(r.id)}
                          disabled={d?.busy}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {d?.busy && !d?.body ? "Drafting…" : d?.open ? "Re-draft" : "Preview"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {d?.open ? (
                    <div className="space-y-3 border-t border-[#e2e8f0] p-4">
                      {d.compliance ? (
                        <div
                          className={`rounded-lg px-3 py-2 text-xs ${
                            sev === "high"
                              ? "bg-rose-50 text-rose-700"
                              : sev === "medium"
                                ? "bg-amber-50 text-amber-800"
                                : "bg-green-50 text-green-700"
                          }`}
                        >
                          <strong>
                            Compliance{typeof d.compliance.score === "number" ? ` · ${d.compliance.score}/100` : ""}:
                          </strong>{" "}
                          {sev === "none"
                            ? "No issues flagged."
                            : (d.compliance.violations ?? [])
                                .map((v) => `[${v.severity}] ${v.rule}`)
                                .join("; ")}
                          {d.compliance.requiredDisclaimers?.length ? (
                            <div className="mt-1">
                              Required disclaimers:{" "}
                              {d.compliance.requiredDisclaimers.join("; ")}
                            </div>
                          ) : null}
                        </div>
                      ) : d.busy ? (
                        <p className="text-xs text-slate-500">Drafting message…</p>
                      ) : null}

                      {r.channel === "email" ? (
                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                          placeholder="Subject"
                          value={d.subject}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [r.id]: { ...prev[r.id], subject: e.target.value },
                            }))
                          }
                        />
                      ) : null}
                      <textarea
                        className="h-36 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        value={d.body}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [r.id]: { ...prev[r.id], body: e.target.value },
                          }))
                        }
                      />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleSend(r.id)}
                          disabled={d.busy || !d.body}
                          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: "#166534" }}
                        >
                          {d.busy ? "Sending…" : "Send"}
                        </button>
                        {sev === "high" ? (
                          <span className="text-xs text-rose-600">
                            High-severity flag — review before sending (advisory,
                            not blocked).
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
