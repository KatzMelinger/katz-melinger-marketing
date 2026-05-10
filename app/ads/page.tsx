"use client";

/**
 * Paid Ads dashboard.
 *
 * Five tabs:
 *   - Overview      — placeholders for spend/leads/CPL until accounts connect
 *   - Compliance    — Claude reviews ad copy against NY/NJ bar rules (live)
 *   - Creatives     — CRUD library of ad copy + visuals
 *   - Keywords      — shared negative keyword list
 *   - Connections   — Google Ads / LSA / Microsoft / Meta / LinkedIn statuses
 *
 * Plain Tailwind only — matches /keyword-research and /ai-search aesthetic.
 */

import { useEffect, useState } from "react";

type Tab = "overview" | "compliance" | "creatives" | "keywords" | "connections";

const PRACTICE_AREAS = [
  "All",
  "Wage & Hour",
  "Discrimination",
  "Harassment",
  "Wrongful Termination",
  "Severance",
  "FMLA",
  "Class Action",
  "Judgment Enforcement",
  "Commercial Collections",
];

const PLATFORMS = [
  { id: "google_search", label: "Google Search" },
  { id: "google_lsa", label: "Google LSA" },
  { id: "microsoft", label: "Microsoft Ads" },
  { id: "meta", label: "Meta (FB/IG)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "other", label: "Other" },
];

// ---------- visual primitives ----------------------------------------------

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
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
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline" | "danger";
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    ghost: "hover:bg-black/5 dark:hover:bg-white/10",
    outline:
      "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
    danger:
      "border border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin ${className}`}
      style={{ width: "1em", height: "1em" }}
      aria-hidden
    >
      ◐
    </span>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  className = "",
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm outline-none focus:ring-1 focus:ring-foreground/30 ${className}`}
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm outline-none focus:ring-1 focus:ring-foreground/30 ${className}`}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm outline-none focus:ring-1 focus:ring-foreground/30 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ScoreText({ score }: { score: number }) {
  const color =
    score >= 90
      ? "text-emerald-600 dark:text-emerald-400"
      : score >= 70
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  return <span className={`font-bold ${color}`}>{score}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    compliant: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    needs_changes: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    non_compliant: "bg-red-500/15 text-red-700 dark:text-red-400",
    not_connected: "bg-black/5 dark:bg-white/10 opacity-80",
    connected: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    error: "bg-red-500/15 text-red-700 dark:text-red-400",
    draft: "bg-black/5 dark:bg-white/10 opacity-80",
    approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    paused: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    archived: "bg-black/5 dark:bg-white/10 opacity-60",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        map[status] || "bg-black/5 dark:bg-white/10"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ---------- top-level page --------------------------------------------------

export default function AdsPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "▣" },
    { id: "compliance", label: "Compliance Checker", icon: "⚖" },
    { id: "creatives", label: "Creative Library", icon: "✎" },
    { id: "keywords", label: "Negative Keywords", icon: "⊘" },
    { id: "connections", label: "Connections", icon: "⎔" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Paid Ads</h1>
        <p className="text-sm opacity-70 mt-1">
          PPC across Google, Microsoft, Meta &amp; LinkedIn — with NY/NJ
          attorney-advertising compliance built in.
        </p>
      </div>

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

      {tab === "overview" && <OverviewTab />}
      {tab === "compliance" && <ComplianceTab />}
      {tab === "creatives" && <CreativesTab />}
      {tab === "keywords" && <KeywordsTab />}
      {tab === "connections" && <ConnectionsTab />}
    </div>
  );
}

// ---------- Overview tab ----------------------------------------------------

function OverviewTab() {
  const stats = [
    { label: "Total Spend (30d)", value: "—", note: "Connect ad accounts" },
    { label: "Leads", value: "—", note: "Connect ad accounts" },
    { label: "Cost / Lead", value: "—", note: "Connect ad accounts" },
    { label: "Signed Cases", value: "—", note: "Needs attribution + CMS" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-bold opacity-50">{s.value}</div>
            <div className="text-xs opacity-70 mt-1">{s.label}</div>
            <div className="text-[10px] opacity-50 mt-1 italic">{s.note}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Pre-launch checklist</div>
        <ul className="space-y-2 text-sm">
          {[
            { done: false, text: "Create Google Ads account + apply for Local Services" },
            { done: false, text: "Create Microsoft Advertising account (import from Google later)" },
            { done: false, text: "Set up Meta Business Manager — declare 'Employment' Special Ad Category" },
            { done: false, text: "Set up LinkedIn Campaign Manager" },
            { done: false, text: "Install Google Tag Manager on katzmelinger.com" },
            { done: false, text: "Wire CallRail conversion events into Google Ads" },
            { done: true,  text: "Build vetted ad copy library (use Creatives + Compliance Checker)" },
            { done: true,  text: "Build negative-keyword list (24 starter terms pre-seeded)" },
            { done: false, text: "Build practice-area landing pages with form + CallRail dynamic numbers" },
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={item.done ? "text-emerald-600 dark:text-emerald-400" : "opacity-40"}>
                {item.done ? "✓" : "○"}
              </span>
              <span className={item.done ? "" : "opacity-80"}>{item.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-semibold mb-3">Recommended channel mix (plaintiff employment law, NY/NJ)</div>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          {[
            { ch: "Google Search Ads", role: "Primary channel — high-intent buyers", weight: "60-70%" },
            { ch: "Google Local Services", role: "Pay-per-lead, top of page, Google Screened", weight: "10-15%" },
            { ch: "Microsoft / Bing Ads", role: "Cheaper CPCs, older demo — easy import from Google", weight: "10%" },
            { ch: "LinkedIn", role: "Severance / wrongful termination targeting (job titles)", weight: "10-15%" },
            { ch: "Meta (FB/IG)", role: "Awareness + retargeting only — Special Ad Category restrictions", weight: "0-5%" },
          ].map((row) => (
            <div key={row.ch} className="border border-black/10 dark:border-white/10 rounded p-3">
              <div className="font-medium">{row.ch}</div>
              <div className="text-xs opacity-70 mt-0.5">{row.role}</div>
              <div className="text-xs opacity-90 mt-1">Suggested: {row.weight}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- Compliance tab --------------------------------------------------

type ComplianceResult = {
  score: number;
  status: "compliant" | "needs_changes" | "non_compliant";
  violations: {
    rule: string;
    severity: "high" | "medium" | "low";
    excerpt: string;
    reason: string;
    fix: string;
  }[];
  warnings: string[];
  requiredDisclaimers: string[];
  rewrites: { headline?: string; description?: string; body?: string }[];
  summary: string;
};

function ComplianceTab() {
  const [copy, setCopy] = useState("");
  const [platform, setPlatform] = useState("google_search");
  const [practiceArea, setPracticeArea] = useState("All");
  const [jurisdiction, setJurisdiction] = useState<"NY" | "NJ" | "NY,NJ">("NY,NJ");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!copy.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ads/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy, platform, practiceArea, jurisdiction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Check failed");
      setResult(data.result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Ad copy compliance review</div>
        <p className="text-xs opacity-70">
          Reviewed against NY 22 NYCRR Part 1200 (RPC 7.1-7.5) and NJ RPC 7.1-7.5.
          Catches superlatives, result guarantees, missing disclaimers, and
          uncertified-specialist claims.
        </p>

        <div className="grid sm:grid-cols-3 gap-2">
          <Select
            value={platform}
            onChange={setPlatform}
            options={PLATFORMS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <Select
            value={practiceArea}
            onChange={setPracticeArea}
            options={PRACTICE_AREAS.map((p) => ({ value: p, label: p }))}
          />
          <Select
            value={jurisdiction}
            onChange={(v) => setJurisdiction(v as "NY" | "NJ" | "NY,NJ")}
            options={[
              { value: "NY,NJ", label: "NY + NJ" },
              { value: "NY", label: "NY only" },
              { value: "NJ", label: "NJ only" },
            ]}
          />
        </div>

        <TextArea
          value={copy}
          onChange={setCopy}
          placeholder={`Paste ad copy. Example:\n\nHeadline: Top NYC Employment Lawyers\nDescription: We guarantee maximum compensation for unpaid wages. #1 firm for workers.`}
          rows={6}
        />

        <div className="flex gap-2">
          <Button onClick={run} disabled={loading || !copy.trim()}>
            {loading ? <Spinner /> : <span aria-hidden>⚖</span>}
            {loading ? "Checking…" : "Run compliance check"}
          </Button>
          {result && (
            <Button variant="outline" onClick={() => { setResult(null); setError(null); }}>
              Clear
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </Card>

      {result && (
        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-3xl font-bold">
                <ScoreText score={result.score} />
                <span className="text-sm opacity-50 ml-1">/ 100</span>
              </div>
              <StatusPill status={result.status} />
              <span className="text-xs opacity-70 ml-auto">
                {result.violations.length} violation{result.violations.length === 1 ? "" : "s"} •{" "}
                {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm mt-3 opacity-90">{result.summary}</p>
          </Card>

          {result.violations.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Violations</div>
              <div className="space-y-2">
                {result.violations.map((v, i) => (
                  <div key={i} className="border border-black/10 dark:border-white/10 rounded p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                        v.severity === "high"
                          ? "bg-red-500/15 text-red-700 dark:text-red-400"
                          : v.severity === "medium"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                      }`}>
                        {v.severity}
                      </span>
                      <span className="text-xs font-mono opacity-80">{v.rule}</span>
                    </div>
                    <p className="text-sm mt-2">
                      <span className="opacity-60">Excerpt:</span>{" "}
                      <span className="font-medium">"{v.excerpt}"</span>
                    </p>
                    <p className="text-xs opacity-80 mt-1">{v.reason}</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                      → {v.fix}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {result.requiredDisclaimers.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Required disclaimers</div>
              <ul className="space-y-1">
                {result.requiredDisclaimers.map((d, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-amber-600 dark:text-amber-400">!</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.warnings.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Warnings</div>
              <ul className="space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-sm flex gap-2 opacity-80">
                    <span aria-hidden>·</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.rewrites.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Suggested rewrites</div>
              <div className="space-y-3">
                {result.rewrites.map((r, i) => (
                  <div key={i} className="border border-black/10 dark:border-white/10 rounded p-3 space-y-1">
                    {r.headline && (
                      <p className="text-sm">
                        <span className="opacity-60 text-xs">HEADLINE:</span> {r.headline}
                      </p>
                    )}
                    {r.description && (
                      <p className="text-sm">
                        <span className="opacity-60 text-xs">DESCRIPTION:</span> {r.description}
                      </p>
                    )}
                    {r.body && (
                      <p className="text-sm whitespace-pre-wrap">
                        <span className="opacity-60 text-xs">BODY:</span> {r.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Creatives tab ---------------------------------------------------

type Creative = {
  id: string;
  name: string;
  platform: string;
  format: string | null;
  practice_area: string | null;
  headline: string | null;
  description: string | null;
  body: string | null;
  cta: string | null;
  notes: string | null;
  status: string;
  compliance_score: number | null;
  compliance_checked_at: string | null;
  created_at: string;
};

function CreativesTab() {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("google_search");
  const [practiceArea, setPracticeArea] = useState("All");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ads/creatives");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setCreatives(data.creatives || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const reset = () => {
    setName("");
    setHeadline("");
    setDescription("");
    setBody("");
    setCta("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/ads/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          platform,
          practice_area: practiceArea === "All" ? null : practiceArea,
          headline,
          description,
          body,
          cta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create");
      reset();
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
    setCreating(false);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this creative?")) return;
    try {
      const res = await fetch(`/api/ads/creatives/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to delete");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm opacity-70">
          Reusable ad copy, organized by platform and practice area. Build the
          library now so day-1 campaigns have vetted, compliant copy ready.
        </p>
        <Button onClick={() => setShowForm((p) => !p)}>
          <span aria-hidden>+</span> {showForm ? "Cancel" : "New creative"}
        </Button>
      </div>

      {error && (
        <Card className="p-3 border-red-500/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {showForm && (
        <Card className="p-4 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <Input value={name} onChange={setName} placeholder="Internal name (e.g. 'Wage theft v3')" />
            <Select
              value={platform}
              onChange={setPlatform}
              options={PLATFORMS.map((p) => ({ value: p.id, label: p.label }))}
            />
            <Select
              value={practiceArea}
              onChange={setPracticeArea}
              options={PRACTICE_AREAS.map((p) => ({ value: p, label: p }))}
            />
          </div>
          <Input value={headline} onChange={setHeadline} placeholder="Headline (30 chars for Google search)" />
          <Input value={description} onChange={setDescription} placeholder="Description (90 chars for Google search)" />
          <TextArea value={body} onChange={setBody} placeholder="Long body copy (for social/landing/email)" rows={4} />
          <Input value={cta} onChange={setCta} placeholder="CTA (e.g. 'Free consultation')" />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={creating || !name.trim()}>
              {creating ? <Spinner /> : null}
              {creating ? "Saving…" : "Save creative"}
            </Button>
            <Button variant="ghost" onClick={() => { reset(); setShowForm(false); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="p-6 text-center">
          <Spinner /> <span className="ml-2 opacity-70">Loading…</span>
        </Card>
      ) : creatives.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-2xl mb-2" aria-hidden>✎</div>
          <p className="font-medium">No creatives yet</p>
          <p className="text-sm opacity-70 mt-1">
            Create a few headline/description variants per practice area. The
            Compliance Checker can vet them before they go live.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {creatives.map((c) => {
            const platformLabel = PLATFORMS.find((p) => p.id === c.platform)?.label || c.platform;
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.name}</span>
                      <StatusPill status={c.status} />
                      <span className="text-xs opacity-60">{platformLabel}</span>
                      {c.practice_area && (
                        <span className="text-xs opacity-60">· {c.practice_area}</span>
                      )}
                      {typeof c.compliance_score === "number" && (
                        <span className="text-xs opacity-80">
                          · compliance: <ScoreText score={c.compliance_score} />
                        </span>
                      )}
                    </div>
                    {c.headline && <p className="text-sm mt-2 font-medium">{c.headline}</p>}
                    {c.description && <p className="text-sm opacity-80 mt-0.5">{c.description}</p>}
                    {c.body && (
                      <p className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{c.body}</p>
                    )}
                    {c.cta && (
                      <p className="text-xs opacity-70 mt-1">
                        <span className="opacity-50">CTA:</span> {c.cta}
                      </p>
                    )}
                  </div>
                  <Button variant="danger" onClick={() => remove(c.id)} title="Delete">
                    ✕
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Negative keywords tab -------------------------------------------

type NegKeyword = {
  id: string;
  keyword: string;
  match_type: string;
  reason: string | null;
  source: string | null;
  created_at: string;
};

function KeywordsTab() {
  const [items, setItems] = useState<NegKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [matchType, setMatchType] = useState("phrase");
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ads/keywords");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setItems(data.keywords || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!keyword.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/ads/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, match_type: matchType, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to add");
      setKeyword("");
      setReason("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    }
    setAdding(false);
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ads/keywords/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to delete");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const exportText = items
    .map((i) => (i.match_type === "phrase" ? `"${i.keyword}"` : i.match_type === "exact" ? `[${i.keyword}]` : i.keyword))
    .join("\n");

  return (
    <div className="space-y-4">
      <p className="text-sm opacity-70">
        Shared list across every campaign. When you launch Google Ads, paste
        these into the campaign-level negatives so you don't waste budget on
        wrong-intent searches.
      </p>

      <Card className="p-4 space-y-3">
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
          <Input value={keyword} onChange={setKeyword} placeholder='Keyword (e.g. "free legal advice")' />
          <Select
            value={matchType}
            onChange={setMatchType}
            options={[
              { value: "phrase", label: "Phrase" },
              { value: "exact", label: "Exact" },
              { value: "broad", label: "Broad" },
            ]}
          />
          <Button onClick={submit} disabled={adding || !keyword.trim()}>
            {adding ? <Spinner /> : <span aria-hidden>+</span>}
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <Input value={reason} onChange={setReason} placeholder="Reason (optional)" />
        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">List ({items.length})</div>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(exportText);
            }}
            title="Copy to clipboard for Google Ads import"
          >
            ⎘ Copy for Google Ads
          </Button>
        </div>
        {loading ? (
          <div className="text-sm opacity-70">
            <Spinner /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm opacity-70 italic">No keywords yet.</div>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {items.map((k) => (
              <li key={k.id} className="py-2 flex items-center gap-2">
                <span className="text-xs opacity-60 w-14 shrink-0 capitalize">{k.match_type}</span>
                <span className="text-sm font-mono">{k.keyword}</span>
                {k.reason && <span className="text-xs opacity-60 truncate">— {k.reason}</span>}
                <button
                  onClick={() => remove(k.id)}
                  className="ml-auto text-xs opacity-50 hover:opacity-100 hover:text-red-600"
                  title="Delete"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Connections tab -------------------------------------------------

type PlatformAccount = {
  id: string;
  platform: string;
  display_name: string;
  status: string;
  account_id: string | null;
  account_name: string | null;
  connected_at: string | null;
};

const CONNECTION_STEPS: Record<string, string[]> = {
  google_ads: [
    "Create a Google Ads account at ads.google.com",
    "Link to GA4 (already configured) and Search Console",
    "Apply for Local Services Ads (employment law qualifies in NY/NJ)",
    "Generate a developer token + OAuth credentials",
    "Add GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET to Vercel",
  ],
  google_lsa: [
    "Apply via Google Ads → Local Services tab",
    "Complete background checks + license verification",
    "Pass Google Screened review (~2-3 weeks)",
    "Once approved, leads route through your Google Ads account",
  ],
  microsoft_ads: [
    "Create a Microsoft Advertising account at ads.microsoft.com",
    "Use 'Import from Google Ads' to mirror campaigns",
    "Generate API credentials (developer token + OAuth)",
    "Add MICROSOFT_ADS_DEVELOPER_TOKEN + OAuth keys to Vercel",
  ],
  meta_ads: [
    "Create a Meta Business Manager account",
    "Add the Meta Pixel + Conversions API to katzmelinger.com",
    "MUST declare 'Employment' Special Ad Category — limits targeting (no zip / no <18)",
    "Create a System User + access token in Business Settings",
    "Add META_ACCESS_TOKEN + META_AD_ACCOUNT_ID to Vercel",
  ],
  linkedin_ads: [
    "Create a LinkedIn Campaign Manager account",
    "Install the LinkedIn Insight Tag on katzmelinger.com",
    "Apply for Marketing Developer Platform access (required for API)",
    "Generate OAuth credentials",
    "Add LINKEDIN_ACCESS_TOKEN + LINKEDIN_AD_ACCOUNT_ID to Vercel",
  ],
};

function ConnectionsTab() {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ads/connections");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load");
        setAccounts(data.accounts || []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <Card className="p-6 text-center">
        <Spinner /> <span className="ml-2 opacity-70">Loading…</span>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Card className="p-3 border-red-500/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}
      {accounts.map((a) => {
        const steps = CONNECTION_STEPS[a.platform] || [];
        return (
          <Card key={a.id} className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>⎔</span>
                <div>
                  <div className="font-medium text-sm">{a.display_name}</div>
                  <div className="text-xs opacity-60">{a.platform}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={a.status} />
                <Button
                  variant="outline"
                  disabled={a.status === "connected"}
                  title="OAuth flow not wired yet — follow the setup checklist below"
                >
                  {a.status === "connected" ? "Connected" : "Connect"}
                </Button>
              </div>
            </div>
            {a.status !== "connected" && steps.length > 0 && (
              <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
                <div className="text-xs opacity-70 uppercase tracking-wider mb-2">Setup checklist</div>
                <ol className="space-y-1 text-sm">
                  {steps.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="opacity-40">{i + 1}.</span>
                      <span className="opacity-90">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
