"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#ffffff";
const BORDER = "#e2e8f0";
const ACCENT = "#185FA5";

type EmailPayload = {
  connected: boolean;
  error?: string;
  selectedListId: string | null;
  availableLists: { id: string; name: string; contacts: number }[];
  dashboard: {
    avgOpenRate: number;
    avgClickRate: number;
    avgBounceRate: number;
    contacts: number;
    monthlyGrowth: number;
  };
  campaigns: {
    id: string;
    name: string;
    subject: string;
    sentAt: string;
    openRate: number;
    clickRate: number;
    bounceRate: number;
  }[];
  contactLists: { name: string; contacts: number; growthRate: number }[];
  sequences: {
    id: string;
    name: string;
    status: "active" | "paused";
    enrolledContacts: number;
  }[];
};

const LIST_STORAGE_KEY = "km_email_selected_list";

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export default function EmailPage() {
  const [data, setData] = useState<EmailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  // Hydrate the saved list selection from localStorage on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIST_STORAGE_KEY);
      if (saved) setListFilter(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const url =
          listFilter && listFilter !== "all"
            ? `/api/email/constant-contact?listId=${encodeURIComponent(listFilter)}`
            : "/api/email/constant-contact?listId=all";
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as EmailPayload;
        if (cancelled) return;
        setData(json);
        setError(json.error ?? null);
      } catch {
        if (!cancelled) setError("Failed to load email marketing data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listFilter]);

  const onListChange = (id: string) => {
    setListFilter(id);
    try {
      localStorage.setItem(LIST_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const campaignTrend = useMemo(
    () =>
      (data?.campaigns ?? []).map((row) => ({
        name: row.name.slice(0, 14),
        openRate: row.openRate,
        clickRate: row.clickRate,
      })),
    [data],
  );

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Email Marketing Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Constant Contact campaigns, contact growth, and lifecycle automation.
            </p>
          </div>

          {data?.connected && data.availableLists.length > 0 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="list-filter" className="text-xs font-medium text-slate-700">
                List
              </label>
              <select
                id="list-filter"
                value={listFilter}
                onChange={(e) => onListChange(e.target.value)}
                disabled={loading}
                className="px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5] disabled:opacity-50"
              >
                <option value="all">
                  All lists ({data.availableLists.reduce((n, l) => n + l.contacts, 0).toLocaleString()})
                </option>
                {data.availableLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.contacts.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {error ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-800"
            style={{ backgroundColor: CARD }}
          >
            {error}
          </div>
        ) : null}

        {data && !data.connected ? (
          <div
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="text-xl font-semibold text-slate-900">
              Constant Contact not connected
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {data.error
                ? `The dashboard is empty because Constant Contact returned: ${data.error}`
                : "The email dashboard is empty because Constant Contact isn't authorized."}{" "}
              OAuth tokens expire — if this used to work, the most likely cause is that
              the access + refresh token pair was revoked or expired. Click below to
              re-authorize and the metrics will populate after one redirect.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                className="inline-block rounded-md bg-[#185FA5] text-white px-4 py-2 text-sm font-medium hover:bg-[#1f6fb8]"
                href="/api/constant-contact/oauth"
              >
                Reconnect Constant Contact
              </a>
              <a
                className="inline-block rounded-md border border-slate-300 text-slate-700 px-4 py-2 text-sm hover:border-slate-400"
                href="/integrations"
              >
                Open integrations status
              </a>
            </div>
            <details className="mt-4">
              <summary className="text-xs text-slate-500 cursor-pointer">
                First-time setup instructions
              </summary>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                <li>
                  In Vercel project settings, set{" "}
                  <code className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs">
                    CONSTANT_CONTACT_CLIENT_ID
                  </code>{" "}
                  and{" "}
                  <code className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs">
                    CONSTANT_CONTACT_CLIENT_SECRET
                  </code>
                  .
                </li>
                <li>Redeploy.</li>
                <li>Click "Reconnect Constant Contact" above to authorize the firm's account.</li>
              </ol>
            </details>
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              label: "Open rate",
              value: pct(data?.dashboard.avgOpenRate ?? 0),
              bg: ACCENT,
            },
            {
              label: "Click rate",
              value: pct(data?.dashboard.avgClickRate ?? 0),
              bg: "#166534",
            },
            {
              label: "Bounce rate",
              value: pct(data?.dashboard.avgBounceRate ?? 0),
              bg: "#b45309",
            },
            {
              label: "Contacts",
              value: (data?.dashboard.contacts ?? 0).toLocaleString(),
              bg: "#475569",
            },
            {
              label: "List growth",
              value: pct(data?.dashboard.monthlyGrowth ?? 0),
              bg: "#7c3aed",
            },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-xl border border-white/5 p-5"
              style={{ backgroundColor: card.bg }}
            >
              <p className="text-sm text-white/90">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {card.value}
              </p>
            </article>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Campaign performance trend</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={campaignTrend}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#0f172a",
                    }}
                  />
                  <Line type="monotone" dataKey="openRate" stroke={ACCENT} />
                  <Line type="monotone" dataKey="clickRate" stroke="#1D9E75" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Contact list growth</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.contactLists ?? []}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#0f172a",
                    }}
                  />
                  <Bar dataKey="contacts" fill={ACCENT} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Recent campaigns</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Campaign</th>
                  <th className="pb-3 pr-4 font-medium">Subject</th>
                  <th className="pb-3 pr-4 font-medium">Sent</th>
                  <th className="pb-3 pr-4 font-medium">Open</th>
                  <th className="pb-3 pr-4 font-medium">Click</th>
                  <th className="pb-3 font-medium">Bounce</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {(data?.campaigns ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[#e2e8f0]/60">
                    <td className="py-2 pr-4 text-slate-900">{row.name}</td>
                    <td className="py-2 pr-4">{row.subject}</td>
                    <td className="py-2 pr-4">
                      {new Date(row.sentAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{pct(row.openRate)}</td>
                    <td className="py-2 pr-4 tabular-nums">{pct(row.clickRate)}</td>
                    <td className="py-2 tabular-nums">{pct(row.bounceRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Automated sequences</h2>
            <div className="space-y-3">
              {(data?.sequences ?? []).map((seq) => (
                <div
                  key={seq.id}
                  className="rounded-lg border border-[#e2e8f0] p-4 text-sm"
                >
                  <p className="font-semibold text-slate-900">{seq.name}</p>
                  <p className="mt-1 text-slate-500">
                    Status: <span className="capitalize">{seq.status}</span> · Enrolled:{" "}
                    {seq.enrolledContacts.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-xl border border-dashed p-6"
            style={{ backgroundColor: CARD, borderColor: "#185FA5" }}
          >
            <h2 className="text-lg font-semibold text-slate-900">Campaign creation wizard</h2>
            <p className="mt-2 text-sm text-slate-600">
              Subject, content, audience, and schedule workflow.
            </p>
            <div className="mt-4 grid gap-3">
              <input
                readOnly
                value="Subject line"
                className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-600"
              />
              <textarea
                readOnly
                value="Campaign content"
                className="h-24 rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-600"
              />
              <input
                readOnly
                value="Audience + send schedule"
                className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-600"
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              CMS lead data is included in list growth metrics for list building.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
