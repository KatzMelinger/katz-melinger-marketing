"use client";

/**
 * AI Bot Traffic — crawl observations from GPTBot, ClaudeBot,
 * PerplexityBot, etc. Powered by the ai_bot_hits table; ingestion
 * happens externally (WordPress plugin, Cloudflare Worker, or batch
 * log import — see the "How to enable" section below).
 *
 * If no data is flowing yet, the page renders zero-state with a
 * concrete setup snippet.
 */

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

import { DashCard, DashShell, DashSpinner } from "@/components/dashboard-ui";
import { MarketingNav } from "@/components/marketing-nav";

type Payload = {
  days: number;
  configured: boolean;
  totals: { hits: number; uniqueBots: number };
  byBot: Array<{ bot: string; vendor: string; hits: number; lastSeen: string }>;
  byDay: Array<{ date: string; hits: number }>;
  byPath: Array<{ path: string; hits: number; bots: string[] }>;
  recent: Array<{
    bot: string;
    user_agent: string | null;
    host: string | null;
    path: string | null;
    status: number | null;
    hit_at: string;
    meta: { vendor?: string; purpose?: string } | null;
  }>;
  error?: string;
};

function formatDate(d: string): string {
  if (!d || d.length < 10) return d;
  const [, m, day] = d.slice(0, 10).split("-");
  return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function AiBotTrafficPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/ai-bots/recent?days=30", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const dayChart = useMemo(
    () => (data?.byDay ?? []).map((d) => ({ date: formatDate(d.date), hits: d.hits })),
    [data?.byDay],
  );

  const empty = !data || data.totals.hits === 0;

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <DashShell>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
            AI Ops Hub / Bot Traffic
          </p>
          <h1 className="mt-1 text-2xl font-semibold">AI bot crawls</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and other AI
            crawler hits to your site. GA4 strips bots, so this view
            needs its own ingest path — see "How to enable" below if no data
            is showing.
          </p>
        </header>

        {loading && !data && <DashSpinner />}

        {data && !empty && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Total crawls (30d)" value={data.totals.hits.toLocaleString()} />
              <KpiTile label="Unique bots" value={data.totals.uniqueBots.toString()} />
              <KpiTile
                label="Top bot"
                value={data.byBot[0]?.bot ?? "—"}
                hint={data.byBot[0] ? `${data.byBot[0].hits.toLocaleString()} hits` : ""}
              />
              <KpiTile
                label="Most recent"
                value={data.recent[0] ? relative(data.recent[0].hit_at) : "—"}
                hint={data.recent[0]?.bot ?? ""}
              />
            </section>

            <DashCard>
              <h2 className="text-sm font-semibold mb-3">Daily crawls</h2>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dayChart}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="hits" stroke="#185FA5" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </DashCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <DashCard>
                <h2 className="text-sm font-semibold mb-3">By bot</h2>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byBot.map((b) => ({ name: b.bot, hits: b.hits }))}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                      <Tooltip />
                      <Bar dataKey="hits" fill="#185FA5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashCard>

              <DashCard>
                <h2 className="text-sm font-semibold mb-3">Bot detail</h2>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Bot</th>
                      <th className="pb-2 pr-3 font-medium">Vendor</th>
                      <th className="pb-2 pr-3 font-medium">Hits</th>
                      <th className="pb-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byBot.map((b) => (
                      <tr key={b.bot} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-900">{b.bot}</td>
                        <td className="py-2 pr-3">{b.vendor}</td>
                        <td className="py-2 pr-3 tabular-nums">{b.hits.toLocaleString()}</td>
                        <td className="py-2 text-slate-500">{relative(b.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DashCard>
            </div>

            <DashCard>
              <h2 className="text-sm font-semibold mb-3">Top crawled pages</h2>
              <p className="text-xs text-slate-500 mb-3">
                Pages AI bots are reading most. These are your AI-citation pipeline — make sure
                the content is high quality.
              </p>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Path</th>
                    <th className="pb-2 pr-3 font-medium">Hits</th>
                    <th className="pb-2 font-medium">Bots</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPath.map((p) => (
                    <tr key={p.path} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-900">{p.path}</td>
                      <td className="py-2 pr-3 tabular-nums">{p.hits.toLocaleString()}</td>
                      <td className="py-2 text-slate-600">{p.bots.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DashCard>

            <DashCard>
              <h2 className="text-sm font-semibold mb-2">Recent activity</h2>
              <ul className="divide-y divide-slate-100">
                {data.recent.slice(0, 20).map((r, i) => (
                  <li key={i} className="py-2 flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-slate-900">
                        {r.bot}{" "}
                        <span className="text-slate-500">{r.path ?? "/"}</span>
                      </p>
                      {r.user_agent && (
                        <p className="text-[10px] text-slate-400 font-mono truncate">
                          {r.user_agent}
                        </p>
                      )}
                    </div>
                    <span className="text-slate-500 shrink-0">{relative(r.hit_at)}</span>
                  </li>
                ))}
              </ul>
            </DashCard>
          </>
        )}

        {empty && (
          <DashCard>
            <h2 className="text-sm font-semibold">No AI bot crawls recorded yet</h2>
            <p className="mt-2 text-sm text-slate-600">
              GA4 strips bot traffic, so this view depends on an external collector pushing
              observations to <code className="font-mono text-xs">/api/ai-bots/ingest</code>. Pick
              whichever path matches your stack:
            </p>

            <div className="mt-4 space-y-4">
              <SetupBlock
                title="Option A — WordPress (drop into theme functions.php)"
                lang="php"
                code={`add_action('init', function () {
  $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
  if (!preg_match('/GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|YouBot|Bytespider|Amazonbot|AppleBot|Diffbot/i', $ua)) {
    return;
  }
  wp_remote_post('${typeof window !== "undefined" ? window.location.origin : "https://YOUR-DASHBOARD"}/api/ai-bots/ingest', [
    'timeout' => 1, 'blocking' => false,
    'headers' => ['Content-Type' => 'application/json'],
    'body' => wp_json_encode([
      'userAgent' => $ua,
      'path' => $_SERVER['REQUEST_URI'] ?? null,
      'host' => $_SERVER['HTTP_HOST'] ?? null,
      'status' => 200,
    ]),
  ]);
});`}
              />

              <SetupBlock
                title="Option B — Cloudflare Worker (in front of your site)"
                lang="js"
                code={`export default {
  async fetch(req, env, ctx) {
    const res = await fetch(req);
    const ua = req.headers.get('user-agent') || '';
    if (/GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|YouBot|Bytespider|Amazonbot|AppleBot|Diffbot/i.test(ua)) {
      ctx.waitUntil(fetch('${typeof window !== "undefined" ? window.location.origin : "https://YOUR-DASHBOARD"}/api/ai-bots/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userAgent: ua,
          path: new URL(req.url).pathname,
          host: new URL(req.url).hostname,
          status: res.status,
        }),
      }));
    }
    return res;
  }
};`}
              />

              <SetupBlock
                title="Option C — Cron job tailing access logs (nightly batch)"
                lang="bash"
                code={`grep -E 'GPTBot|ClaudeBot|PerplexityBot|Google-Extended|CCBot' /var/log/nginx/access.log \\
  | awk '{print "{\\"userAgent\\":\\"" $12 "\\",\\"path\\":\\"" $7 "\\",\\"status\\":" $9 "}"}' \\
  | while read line; do
      curl -s -X POST '${typeof window !== "undefined" ? window.location.origin : "https://YOUR-DASHBOARD"}/api/ai-bots/ingest' \\
        -H 'Content-Type: application/json' \\
        -d "$line"
    done`}
              />
            </div>

            <p className="mt-4 text-xs text-slate-500">
              Run <code className="font-mono">supabase/ai_bot_hits_schema.sql</code> in the Supabase
              SQL editor before enabling any of these — that creates the destination table.
            </p>
          </DashCard>
        )}
      </DashShell>
    </div>
  );
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <DashCard>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </DashCard>
  );
}

function SetupBlock({
  title,
  lang,
  code,
}: {
  title: string;
  lang: string;
  code: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500">
          {lang}
        </span>
      </div>
      <pre className="text-[11px] text-slate-800 overflow-x-auto whitespace-pre-wrap font-mono">
        {code}
      </pre>
    </div>
  );
}
