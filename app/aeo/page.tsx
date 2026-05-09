"use client";

/**
 * Answer Engine Optimization dashboard.
 *
 * Goes beyond the existing AI Search Readiness scanner: instead of asking
 * "is the firm's site set up to be cited," it asks "is the firm actually
 * being cited" by running a curated set of buyer-intent prompts against
 * every available LLM and parsing the answers for brand mentions, source
 * citations, and sentiment.
 *
 * Tabs:
 *   - Overview: prompt coverage, share-of-voice, sentiment, latest run status
 *   - Prompts: manage the buyer prompts we test
 *   - Targets: manage the firm + competitor brands we track in answers
 *   - Sources: domains AI engines pull from (highest leverage to influence)
 *   - Runs: history of sweeps
 */

import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";

type Tab = "overview" | "prompts" | "targets" | "sources" | "runs";

type ProviderStatus = {
  id: "claude" | "openai" | "perplexity" | "gemini";
  label: string;
  available: boolean;
  defaultModel: string;
};

type Dashboard = {
  runId: string | null;
  runDate: string | null;
  providersUsed?: string[];
  providerStatus: ProviderStatus[];
  activeRunId: string | null;
  enabledProviders?: string[];
  promptCoverage: { total: number; covered: number; pct: number };
  providerCoverage: { provider: string; total: number; covered: number; pct: number }[];
  shareOfVoice: {
    provider: string;
    total: number;
    brands: { name: string; count: number; type: "self" | "competitor"; sharePct: number }[];
  }[];
  topCitationDomains: { domain: string; count: number }[];
  authoritySources: { domain: string; count: number }[];
  sentimentDistribution: Record<string, number>;
  promptDetail: {
    promptId: string;
    prompt: string;
    category: string | null;
    intent: string | null;
    geography: string | null;
    cells: {
      provider: string;
      model: string | null;
      selfMentioned: boolean;
      selfPosition: number | null;
      selfSentiment: string | null;
      competitors: { name: string; position: number }[];
      citationCount: number;
      latencyMs: number | null;
      error: string | null;
      responsePreview: string;
    }[];
  }[];
};

type Prompt = {
  id: string;
  prompt: string;
  category: string | null;
  intent: string | null;
  geography: string | null;
  enabled: boolean;
};

type Target = {
  id: string;
  name: string;
  type: "self" | "competitor";
  domain: string | null;
  aliases: string[];
};

type Run = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  providers: string[];
  prompt_count: number;
  response_count: number;
  failure_count: number;
  started_at: string | null;
  completed_at: string | null;
  triggered_by: string | null;
  error: string | null;
  created_at: string;
};

// ---------- visual primitives (match /ai-search aesthetic) -----------------

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-black/10 dark:border-white/10 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    ghost: "hover:bg-black/5 dark:hover:bg-white/10",
    outline: "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
    danger: "border border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="inline-block animate-spin" style={{ width: "1em", height: "1em" }} aria-hidden>
      ◐
    </span>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "emerald" | "red" | "amber" | "blue" | "violet" | "neutral";
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    neutral: "bg-black/5 dark:bg-white/10 opacity-80",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[tone]}`}>
      {children}
    </span>
  );
}

function Bar({ pct, tone }: { pct: number; tone?: "self" | "competitor" }) {
  const bg = tone === "self" ? "bg-emerald-500" : tone === "competitor" ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="w-full bg-black/5 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full ${bg}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, transition: "width 0.5s" }}
      />
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function sentimentTone(s: string | null): "emerald" | "red" | "amber" | "neutral" {
  if (s === "positive") return "emerald";
  if (s === "negative") return "red";
  if (s === "mixed") return "amber";
  return "neutral";
}

// ---------- top-level page --------------------------------------------------

export default function AEOPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const refreshAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p, t, r] = await Promise.all([
        fetch("/api/aeo/dashboard").then((res) => res.json()),
        fetch("/api/aeo/prompts").then((res) => res.json()),
        fetch("/api/aeo/targets").then((res) => res.json()),
        fetch("/api/aeo/runs").then((res) => res.json()),
      ]);
      if (d?.error) throw new Error(d.error);
      setDashboard(d);
      setPrompts(p.prompts ?? []);
      setTargets(t.targets ?? []);
      setRuns(r.runs ?? []);
      setActiveRunId(d.activeRunId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  // Poll while a run is in flight.
  useEffect(() => {
    if (!activeRunId) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/aeo/runs/${activeRunId}`);
        const data = await res.json();
        if (data?.status === "done" || data?.status === "failed") {
          setActiveRunId(null);
          refreshAll();
        }
      } catch {
        /* ignore poll errors */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [activeRunId]);

  const startRun = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/aeo/runs/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to start");
      setActiveRunId(data.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
    }
    setStarting(false);
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "▣" },
    { id: "prompts", label: "Prompts", icon: "❓" },
    { id: "targets", label: "Brands", icon: "★" },
    { id: "sources", label: "Sources", icon: "🔗" },
    { id: "runs", label: "Runs", icon: "↻" },
  ];

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Answer Engine Optimization</h1>
          <p className="text-sm opacity-70 mt-1 max-w-2xl">
            Track how often the firm shows up when buyers ask AI for an attorney —
            across ChatGPT, Claude, Perplexity, and Gemini. Configure prompts, watch
            share-of-voice vs. competitors, and see which sources the AI pulls from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dashboard && (
            <ProviderChips providers={dashboard.providerStatus} />
          )}
          <Button onClick={startRun} disabled={starting || !!activeRunId}>
            {starting || activeRunId ? <Spinner /> : <span aria-hidden>▶</span>}
            {activeRunId ? "Run in progress…" : "Run sweep"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-3 border-red-500/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {activeRunId && (
        <Card className="p-3 border-blue-500/40">
          <p className="text-sm flex items-center gap-2">
            <Spinner />
            <span>
              A sweep is running in the background. Dashboard will refresh when it
              completes.
            </span>
          </p>
        </Card>
      )}

      <div className="flex gap-2 border-b border-black/10 dark:border-white/10 pb-3 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 ${
              tab === t.id
                ? "bg-foreground text-background"
                : "hover:bg-black/5 dark:hover:bg-white/10"
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {loading && !dashboard && (
        <Card className="p-10 text-center">
          <Spinner />
          <p className="mt-2 text-sm opacity-70">Loading…</p>
        </Card>
      )}

      {tab === "overview" && dashboard && <OverviewTab dashboard={dashboard} />}
      {tab === "prompts" && (
        <PromptsTab prompts={prompts} onChange={refreshAll} />
      )}
      {tab === "targets" && (
        <TargetsTab targets={targets} onChange={refreshAll} />
      )}
      {tab === "sources" && dashboard && <SourcesTab dashboard={dashboard} />}
      {tab === "runs" && <RunsTab runs={runs} />}
      </div>
    </>
  );
}

// ---------- Overview --------------------------------------------------------

function ProviderChips({ providers }: { providers: ProviderStatus[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {providers.map((p) => (
        <span
          key={p.id}
          title={p.available ? `Connected — ${p.defaultModel}` : "API key not set — provider skipped"}
          className={`text-[11px] px-2 py-1 rounded-full font-medium ${
            p.available
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-black/5 dark:bg-white/10 opacity-60"
          }`}
        >
          {p.available ? "● " : "○ "}
          {p.label}
        </span>
      ))}
    </div>
  );
}

function OverviewTab({ dashboard }: { dashboard: Dashboard }) {
  if (!dashboard.runId) {
    return (
      <Card className="p-10 text-center space-y-2">
        <div className="text-3xl" aria-hidden>🤖</div>
        <h3 className="text-lg font-semibold">No sweeps yet</h3>
        <p className="text-sm opacity-70 max-w-md mx-auto">
          Click <span className="font-semibold">Run sweep</span> at the top right
          to query every available AI engine with the prompts on the Prompts tab.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider opacity-70">Prompt Coverage</div>
          <div className="text-3xl font-bold mt-1">{dashboard.promptCoverage.pct}%</div>
          <div className="text-xs opacity-70 mt-1">
            We appear in {dashboard.promptCoverage.covered} of {dashboard.promptCoverage.total} prompts
          </div>
          <div className="mt-3"><Bar pct={dashboard.promptCoverage.pct} tone="self" /></div>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider opacity-70">Per-Provider Coverage</div>
          <div className="space-y-2 mt-2">
            {dashboard.providerCoverage.map((pc) => (
              <div key={pc.provider} className="flex items-center gap-3 text-sm">
                <span className="capitalize w-20 opacity-80">{pc.provider}</span>
                <div className="flex-1"><Bar pct={pc.pct} tone="self" /></div>
                <span className="w-16 text-right opacity-80">{pc.pct}%</span>
              </div>
            ))}
            {dashboard.providerCoverage.length === 0 && (
              <p className="text-xs opacity-70">No responses yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider opacity-70">Sentiment</div>
          <div className="space-y-2 mt-2 text-sm">
            <SentimentRow label="Positive" tone="emerald" count={dashboard.sentimentDistribution.positive ?? 0} />
            <SentimentRow label="Neutral" tone="neutral" count={dashboard.sentimentDistribution.neutral ?? 0} />
            <SentimentRow label="Mixed" tone="amber" count={dashboard.sentimentDistribution.mixed ?? 0} />
            <SentimentRow label="Negative" tone="red" count={dashboard.sentimentDistribution.negative ?? 0} />
          </div>
          <div className="text-[11px] opacity-60 mt-3">
            Last sweep: {fmtDate(dashboard.runDate)}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-3">
          Share of Voice — by provider
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {dashboard.shareOfVoice.map((sov) => (
            <div key={sov.provider} className="space-y-2">
              <div className="text-sm font-medium capitalize">{sov.provider}</div>
              {sov.brands.length === 0 && <p className="text-xs opacity-60">No brand mentions in this provider's answers.</p>}
              {sov.brands.slice(0, 8).map((b) => (
                <div key={b.name} className="flex items-center gap-3 text-sm">
                  <span className="w-44 truncate opacity-90 flex items-center gap-2">
                    {b.type === "self" && <Pill tone="emerald">us</Pill>}
                    <span className="truncate">{b.name}</span>
                  </span>
                  <div className="flex-1"><Bar pct={b.sharePct} tone={b.type} /></div>
                  <span className="w-16 text-right opacity-80">{b.sharePct}% ({b.count})</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-3">
          Per-prompt outcomes
        </div>
        <div className="space-y-2">
          {dashboard.promptDetail.map((pd) => (
            <PromptRow key={pd.promptId} pd={pd} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function SentimentRow({ label, count, tone }: { label: string; count: number; tone: "emerald" | "amber" | "red" | "neutral" }) {
  return (
    <div className="flex items-center gap-2">
      <Pill tone={tone}>{label}</Pill>
      <span className="opacity-80">{count}</span>
    </div>
  );
}

function PromptRow({ pd }: { pd: Dashboard["promptDetail"][number] }) {
  const [open, setOpen] = useState(false);
  const anyMention = pd.cells.some((c) => c.selfMentioned);
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{pd.prompt}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {pd.category && <Pill tone="violet">{pd.category}</Pill>}
            {pd.intent && <Pill tone="blue">{pd.intent}</Pill>}
            {pd.geography && <Pill tone="neutral">{pd.geography}</Pill>}
            <Pill tone={anyMention ? "emerald" : "red"}>
              {anyMention ? "✓ mentioned" : "✕ missing"}
            </Pill>
          </div>
        </div>
        <span className="text-sm opacity-50">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-black/10 dark:border-white/10 divide-y divide-black/5 dark:divide-white/5">
          {pd.cells.map((c, i) => (
            <div key={i} className="p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-medium capitalize">{c.provider}</span>
                {c.error ? (
                  <Pill tone="red">error</Pill>
                ) : c.selfMentioned ? (
                  <>
                    <Pill tone="emerald">mentioned · pos {c.selfPosition ?? "?"}</Pill>
                    <Pill tone={sentimentTone(c.selfSentiment)}>{c.selfSentiment ?? "—"}</Pill>
                  </>
                ) : (
                  <Pill tone="red">not mentioned</Pill>
                )}
                {c.competitors.length > 0 && (
                  <span className="text-xs opacity-70">
                    Competitors: {c.competitors.map((m) => `${m.name} (#${m.position})`).join(", ")}
                  </span>
                )}
                <span className="text-xs opacity-60 ml-auto">
                  {c.citationCount} cites · {c.latencyMs ?? "—"}ms
                </span>
              </div>
              {c.error ? (
                <p className="text-xs text-red-700 dark:text-red-400 font-mono">{c.error}</p>
              ) : (
                <p className="text-xs opacity-80 whitespace-pre-wrap">{c.responsePreview}{c.responsePreview.length >= 320 ? "…" : ""}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Sources ---------------------------------------------------------

function SourcesTab({ dashboard }: { dashboard: Dashboard }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-3">
          Top citation sources (latest sweep)
        </div>
        <div className="space-y-1.5">
          {dashboard.topCitationDomains.length === 0 && (
            <p className="text-xs opacity-60">No citations recorded yet.</p>
          )}
          {dashboard.topCitationDomains.map((d) => (
            <div key={d.domain} className="flex items-center justify-between text-sm">
              <span className="truncate">{d.domain}</span>
              <span className="opacity-70">{d.count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-3">
          Authority sources where we appear
        </div>
        <div className="space-y-1.5">
          {dashboard.authoritySources.length === 0 && (
            <p className="text-xs opacity-60">
              When the firm gets mentioned, no high-authority domains (Wikipedia,
              Reddit, YouTube, G2, Avvo, SuperLawyers, etc) showed up alongside us.
              Building presence on these is one of the strongest GEO signals.
            </p>
          )}
          {dashboard.authoritySources.map((d) => (
            <div key={d.domain} className="flex items-center justify-between text-sm">
              <span className="truncate">{d.domain}</span>
              <span className="opacity-70">{d.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Prompts ---------------------------------------------------------

function PromptsTab({ prompts, onChange }: { prompts: Prompt[]; onChange: () => void }) {
  const [draft, setDraft] = useState({ prompt: "", category: "", intent: "informational", geography: "" });
  const [saving, setSaving] = useState(false);

  const addPrompt = async () => {
    if (!draft.prompt.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/aeo/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDraft({ prompt: "", category: "", intent: "informational", geography: "" });
      onChange();
    } finally {
      setSaving(false);
    }
  };

  const togglePrompt = async (p: Prompt) => {
    await fetch(`/api/aeo/prompts/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    onChange();
  };

  const deletePrompt = async (p: Prompt) => {
    if (!confirm(`Delete prompt "${p.prompt}"?`)) return;
    await fetch(`/api/aeo/prompts/${p.id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Add a buyer prompt</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={draft.prompt}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            placeholder="e.g. Best NYC employment lawyer for unpaid overtime"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm sm:col-span-2"
          />
          <input
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="Category (wage & hour, discrimination, etc)"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <input
            value={draft.geography}
            onChange={(e) => setDraft((d) => ({ ...d, geography: e.target.value }))}
            placeholder="Geography (NYC, Manhattan, NJ…)"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <select
            value={draft.intent}
            onChange={(e) => setDraft((d) => ({ ...d, intent: e.target.value }))}
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          >
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
            <option value="navigational">Navigational</option>
          </select>
          <Button onClick={addPrompt} disabled={saving || !draft.prompt.trim()}>
            {saving ? <Spinner /> : "Add"}
          </Button>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs opacity-60">
            <tr>
              <th className="px-4 py-2">Prompt</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Intent</th>
              <th className="px-4 py-2">Geo</th>
              <th className="px-4 py-2">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {prompts.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.prompt}</td>
                <td className="px-4 py-2 opacity-80">{p.category ?? "—"}</td>
                <td className="px-4 py-2 opacity-80">{p.intent ?? "—"}</td>
                <td className="px-4 py-2 opacity-80">{p.geography ?? "—"}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => togglePrompt(p)}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      p.enabled
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-black/5 dark:bg-white/10 opacity-60"
                    }`}
                  >
                    {p.enabled ? "On" : "Off"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="danger" onClick={() => deletePrompt(p)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {prompts.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center opacity-60" colSpan={6}>
                  No prompts yet — add some above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Targets ---------------------------------------------------------

function TargetsTab({ targets, onChange }: { targets: Target[]; onChange: () => void }) {
  const [draft, setDraft] = useState({ name: "", domain: "", aliases: "" });
  const [saving, setSaving] = useState(false);

  const addTarget = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/aeo/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          domain: draft.domain || null,
          aliases: draft.aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setDraft({ name: "", domain: "", aliases: "" });
      onChange();
    } finally {
      setSaving(false);
    }
  };

  const deleteTarget = async (t: Target) => {
    if (t.type === "self") {
      alert("The self-target is required and cannot be deleted from the UI.");
      return;
    }
    if (!confirm(`Delete competitor "${t.name}"?`)) return;
    await fetch(`/api/aeo/targets/${t.id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Track a competitor</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Competitor firm name"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <input
            value={draft.domain}
            onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))}
            placeholder="domain.com"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <input
            value={draft.aliases}
            onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))}
            placeholder="Aliases (comma-separated)"
            className="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
        </div>
        <div className="mt-3">
          <Button onClick={addTarget} disabled={saving || !draft.name.trim()}>
            {saving ? <Spinner /> : "Add competitor"}
          </Button>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs opacity-60">
            <tr>
              <th className="px-4 py-2">Brand</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Domain</th>
              <th className="px-4 py-2">Aliases</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {targets.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 font-medium">{t.name}</td>
                <td className="px-4 py-2">
                  <Pill tone={t.type === "self" ? "emerald" : "amber"}>{t.type}</Pill>
                </td>
                <td className="px-4 py-2 opacity-80">{t.domain ?? "—"}</td>
                <td className="px-4 py-2 opacity-70 text-xs">
                  {(t.aliases ?? []).join(", ") || "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {t.type === "competitor" && (
                    <Button variant="danger" onClick={() => deleteTarget(t)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Runs ------------------------------------------------------------

function RunsTab({ runs }: { runs: Run[] }) {
  return (
    <Card>
      <table className="w-full text-sm">
        <thead className="text-left text-xs opacity-60">
          <tr>
            <th className="px-4 py-2">Started</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Providers</th>
            <th className="px-4 py-2">Prompts</th>
            <th className="px-4 py-2">Responses</th>
            <th className="px-4 py-2">Failures</th>
            <th className="px-4 py-2">Trigger</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 opacity-80">{fmtDate(r.created_at)}</td>
              <td className="px-4 py-2">
                <Pill
                  tone={
                    r.status === "done"
                      ? "emerald"
                      : r.status === "failed"
                      ? "red"
                      : r.status === "running"
                      ? "blue"
                      : "neutral"
                  }
                >
                  {r.status}
                </Pill>
                {r.error && (
                  <span className="ml-2 text-xs text-red-700 dark:text-red-400">{r.error}</span>
                )}
              </td>
              <td className="px-4 py-2 opacity-80 text-xs">
                {(r.providers ?? []).join(", ")}
              </td>
              <td className="px-4 py-2">{r.prompt_count}</td>
              <td className="px-4 py-2">{r.response_count}</td>
              <td className="px-4 py-2">{r.failure_count}</td>
              <td className="px-4 py-2 opacity-80">{r.triggered_by}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center opacity-60" colSpan={7}>
                No runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
