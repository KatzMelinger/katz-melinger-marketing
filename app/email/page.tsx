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

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

type EmailPayload = {
  connected: boolean;
  error?: string;
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

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export default function EmailPage() {
  const [data, setData] = useState<EmailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/email/constant-contact", {
          cache: "no-store",
        });
        const json = (await res.json()) as EmailPayload;
        if (cancelled) return;
        setData(json);
        setError(json.error ?? null);
      } catch {
        if (!cancelled) setError("Failed to load email marketing data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Email Marketing Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Constant Contact campaigns, contact growth, and lifecycle automation.
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
                  <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
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
                  <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
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
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Campaign</th>
                  <th className="pb-3 pr-4 font-medium">Subject</th>
                  <th className="pb-3 pr-4 font-medium">Sent</th>
                  <th className="pb-3 pr-4 font-medium">Open</th>
                  <th className="pb-3 pr-4 font-medium">Click</th>
                  <th className="pb-3 font-medium">Bounce</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {(data?.campaigns ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[#2a3f5f]/60">
                    <td className="py-2 pr-4 text-white">{row.name}</td>
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
                  className="rounded-lg border border-[#2a3f5f] p-4 text-sm"
                >
                  <p className="font-semibold text-white">{seq.name}</p>
                  <p className="mt-1 text-slate-400">
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
            <h2 className="text-lg font-semibold text-white">Campaign creation wizard</h2>
            <p className="mt-2 text-sm text-slate-300">
              Subject, content, audience, and schedule workflow.
            </p>
            <div className="mt-4 grid gap-3">
              <input
                readOnly
                value="Subject line"
                className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-300"
              />
              <textarea
                readOnly
                value="Campaign content"
                className="h-24 rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-300"
              />
              <input
                readOnly
                value="Audience + send schedule"
                className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-300"
              />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              CMS lead data is included in list growth metrics for list building.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
