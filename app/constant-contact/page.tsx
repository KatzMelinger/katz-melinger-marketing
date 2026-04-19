"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MarketingNav } from "@/components/marketing-nav";

const BG = "#0f1729";
const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

const SYNC_STORAGE_PREFIX = "constant-contact-list-sync:";
const ACTIVITY_LOG_KEY = "constant-contact-activity-log";

const REFRESH_MS = 30_000;

/** Email campaign row from GET /api/constant-contact?action=campaigns */
export interface EmailCampaign {
  campaign_id?: string;
  name?: string;
  email_subject?: string;
  current_status?: string | Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

/** Contact list from GET /api/constant-contact?action=lists */
export interface ContactList {
  list_id?: string;
  name?: string;
  description?: string;
  membership_count?: number;
  [key: string]: unknown;
}

export interface CampaignsApiResponse {
  campaigns: EmailCampaign[];
  _links?: Record<string, unknown>;
}

export interface ListsApiResponse {
  lists: ContactList[];
  lists_count?: number;
}

export interface ApiErrorJson {
  error?: string;
  status?: number;
  details?: unknown;
}

const AUTOMATION_TRIGGERS = [
  "intake_complete",
  "case_closed",
  "settlement_reached",
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

type TabId = "campaigns" | "lists" | "automation" | "analytics";

/** Aggregated metrics from GET /api/constant-contact?action=analytics */
export interface EmailAnalyticsSummary {
  total_campaigns: number;
  total_contacts: number;
  total_opens: number;
  total_clicks: number;
  total_sent: number;
  overall_open_rate: number;
  overall_click_rate: number;
  revenue_generated: number;
}

export interface CampaignPerformanceRow {
  campaign_id: string;
  campaign_name: string;
  send_date: string | null;
  opens: number;
  clicks: number;
  emails_sent: number;
  open_rate: number;
  click_rate: number;
}

export interface SyncActivityServerRow {
  id?: string;
  list_id: string | null;
  synced_count: number;
  created_at: string;
  message?: string | null;
}

type ClientSyncActivity = {
  at: string;
  list_id: string;
  synced: number;
  message?: string;
};

type MergedSyncRow = {
  at: string;
  list_id: string | null;
  synced_count: number;
  message: string | null;
  source: "server" | "client";
};

/** Automation rule from Supabase via GET /api/constant-contact?action=automation */
export interface AutomationRule {
  id?: string;
  name?: string;
  trigger_type?: string;
  active?: boolean;
  email_sequence?: string;
  sequence_count?: number;
  created_at?: string;
  [key: string]: unknown;
}

function formatStatus(status: EmailCampaign["current_status"]): string {
  if (status == null) return "—";
  if (typeof status === "string") return status;
  if (typeof status === "object") {
    const s = status as Record<string, unknown>;
    const direct =
      (typeof s.status === "string" && s.status) ||
      (typeof s.state === "string" && s.state) ||
      (typeof s.name === "string" && s.name);
    if (direct) return direct;
  }
  return "—";
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ensureTrackingHtml(html: string): string {
  const trimmed = html.trim();
  if (trimmed.includes("[[trackingImage]]")) return trimmed;
  return `<html><body>[[trackingImage]]${trimmed}</body></html>`;
}

function readStoredSync(listId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${SYNC_STORAGE_PREFIX}${listId}`);
    if (!raw) return null;
    const o = JSON.parse(raw) as { last_sync_at?: string };
    return typeof o.last_sync_at === "string" ? o.last_sync_at : null;
  } catch {
    return null;
  }
}

function writeStoredSync(listId: string, last_sync_at: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    `${SYNC_STORAGE_PREFIX}${listId}`,
    JSON.stringify({ last_sync_at }),
  );
}

function readClientActivityLog(): ClientSyncActivity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACTIVITY_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is ClientSyncActivity =>
          row !== null &&
          typeof row === "object" &&
          typeof (row as ClientSyncActivity).at === "string" &&
          typeof (row as ClientSyncActivity).list_id === "string",
      )
      .map((row) => ({
        at: row.at,
        list_id: row.list_id,
        synced: typeof row.synced === "number" ? row.synced : 0,
        message: typeof row.message === "string" ? row.message : undefined,
      }));
  } catch {
    return [];
  }
}

function appendClientActivityLog(entry: ClientSyncActivity): void {
  if (typeof window === "undefined") return;
  const prev = readClientActivityLog();
  prev.unshift(entry);
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(prev.slice(0, 40)));
}

function mergeSyncActivity(
  server: SyncActivityServerRow[],
  client: ClientSyncActivity[],
): MergedSyncRow[] {
  const rows: MergedSyncRow[] = [
    ...server.map((s) => ({
      at: s.created_at,
      list_id: s.list_id,
      synced_count: s.synced_count,
      message: s.message ?? null,
      source: "server" as const,
    })),
    ...client.map((c) => ({
      at: c.at,
      list_id: c.list_id,
      synced_count: c.synced,
      message: c.message ?? null,
      source: "client" as const,
    })),
  ];
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set<string>();
  const out: MergedSyncRow[] = [];
  for (const r of rows) {
    const key = `${r.at}|${r.list_id ?? ""}|${r.synced_count}|${r.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.slice(0, 25);
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Green = strong, amber = mid, red = weak (typical email benchmarks). */
function openRateColor(rate: number): string {
  if (rate >= 20) return "text-emerald-400";
  if (rate >= 12) return "text-amber-300";
  return "text-red-400";
}

function clickRateColor(rate: number): string {
  if (rate >= 3) return "text-emerald-400";
  if (rate >= 1) return "text-amber-300";
  return "text-red-400";
}

export default function ConstantContactPage() {
  const [activeTab, setActiveTab] = useState<TabId>("campaigns");

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [lastSyncByListId, setLastSyncByListId] = useState<Record<string, string>>(
    {},
  );
  const [syncingListId, setSyncingListId] = useState<string | null>(null);
  const [syncBanner, setSyncBanner] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleTrigger, setRuleTrigger] = useState<AutomationTrigger>("intake_complete");
  const [ruleSequence, setRuleSequence] = useState("");
  const [ruleActive, setRuleActive] = useState(true);
  const [createRuleLoading, setCreateRuleLoading] = useState(false);
  const [createRuleError, setCreateRuleError] = useState<string | null>(null);

  const [analyticsSummary, setAnalyticsSummary] = useState<EmailAnalyticsSummary | null>(
    null,
  );
  const [analyticsCampaigns, setAnalyticsCampaigns] = useState<CampaignPerformanceRow[]>(
    [],
  );
  const [analyticsSyncServer, setAnalyticsSyncServer] = useState<SyncActivityServerRow[]>(
    [],
  );
  const [analyticsGeneratedAt, setAnalyticsGeneratedAt] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [clientActivityTick, setClientActivityTick] = useState(0);

  const mergedSyncActivity = useMemo(
    () => mergeSyncActivity(analyticsSyncServer, readClientActivityLog()),
    [analyticsSyncServer, clientActivityTick],
  );

  const sortedPerformanceRows = useMemo(() => {
    return [...analyticsCampaigns]
      .sort((a, b) => {
        const da = a.send_date ? new Date(a.send_date).getTime() : 0;
        const db = b.send_date ? new Date(b.send_date).getTime() : 0;
        return db - da;
      })
      .slice(0, 25);
  }, [analyticsCampaigns]);

  const chartRows = useMemo(() => {
    return sortedPerformanceRows.slice(0, 12).map((r) => ({
      name:
        r.campaign_name.length > 26
          ? `${r.campaign_name.slice(0, 26)}…`
          : r.campaign_name,
      Opens: r.opens,
      Clicks: r.clicks,
    }));
  }, [sortedPerformanceRows]);

  const toggleCampaignList = useCallback((listId: string) => {
    setSelectedListIds((prev) =>
      prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId],
    );
  }, []);

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const res = await fetch("/api/constant-contact?action=campaigns", {
        cache: "no-store",
      });
      const json = (await res.json()) as CampaignsApiResponse & ApiErrorJson;

      if (!res.ok) {
        setCampaignsError(
          json.error ??
            (typeof json.details === "object" && json.details !== null
              ? JSON.stringify(json.details)
              : `Request failed (${res.status})`),
        );
        setCampaigns([]);
        return;
      }

      setCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
    } catch (e) {
      setCampaignsError(e instanceof Error ? e.message : "Failed to load campaigns");
      setCampaigns([]);
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  const loadContactLists = useCallback(async () => {
    setListsLoading(true);
    setListsError(null);
    try {
      const res = await fetch("/api/constant-contact?action=lists", {
        cache: "no-store",
      });
      const json = (await res.json()) as ListsApiResponse & ApiErrorJson;

      if (!res.ok) {
        setListsError(
          json.error ??
            (typeof json.details === "object" && json.details !== null
              ? JSON.stringify(json.details)
              : `Request failed (${res.status})`),
        );
        setContactLists([]);
        return;
      }

      const lists = Array.isArray(json.lists) ? json.lists : [];
      setContactLists(lists);

      setLastSyncByListId((prev) => {
        const next = { ...prev };
        for (const row of lists) {
          const id = row.list_id;
          if (!id || next[id]) continue;
          const stored = readStoredSync(id);
          if (stored) next[id] = stored;
        }
        return next;
      });
    } catch (e) {
      setListsError(e instanceof Error ? e.message : "Failed to load contact lists");
      setContactLists([]);
    } finally {
      setListsLoading(false);
    }
  }, []);

  const loadAutomation = useCallback(async () => {
    setAutomationLoading(true);
    setAutomationError(null);
    try {
      const res = await fetch("/api/constant-contact?action=automation", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiErrorJson & {
        rules?: AutomationRule[];
        needsSchema?: boolean;
        message?: string;
      };

      if (!res.ok) {
        setAutomationError(
          json.error ??
            (typeof json.details === "object" && json.details !== null
              ? JSON.stringify(json.details)
              : `Request failed (${res.status})`),
        );
        setAutomationRules([]);
        return;
      }

      setAutomationRules(Array.isArray(json.rules) ? json.rules : []);
      if (json.needsSchema && json.message) {
        setAutomationError(json.message);
      }
    } catch (e) {
      setAutomationError(e instanceof Error ? e.message : "Failed to load automation rules");
      setAutomationRules([]);
    } finally {
      setAutomationLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/constant-contact?action=analytics", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiErrorJson & {
        summary?: EmailAnalyticsSummary;
        campaigns?: CampaignPerformanceRow[];
        sync_activity?: SyncActivityServerRow[];
        generated_at?: string;
      };

      if (!res.ok) {
        setAnalyticsError(
          json.error ??
            (typeof json.details === "object" && json.details !== null
              ? JSON.stringify(json.details)
              : `Request failed (${res.status})`),
        );
        setAnalyticsSummary(null);
        setAnalyticsCampaigns([]);
        setAnalyticsSyncServer([]);
        setAnalyticsGeneratedAt(null);
        return;
      }

      setAnalyticsSummary(json.summary ?? null);
      setAnalyticsCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
      setAnalyticsSyncServer(
        Array.isArray(json.sync_activity) ? json.sync_activity : [],
      );
      setAnalyticsGeneratedAt(
        typeof json.generated_at === "string" ? json.generated_at : null,
      );
      setClientActivityTick((t) => t + 1);
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : "Failed to load analytics");
      setAnalyticsSummary(null);
      setAnalyticsCampaigns([]);
      setAnalyticsSyncServer([]);
      setAnalyticsGeneratedAt(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (activeTab === "lists" || activeTab === "campaigns") {
      void loadContactLists();
    }
  }, [activeTab, loadContactLists]);

  useEffect(() => {
    if (activeTab === "automation") {
      void loadAutomation();
    }
  }, [activeTab, loadAutomation]);

  useEffect(() => {
    if (activeTab === "analytics") {
      void loadAnalytics();
    }
  }, [activeTab, loadAnalytics]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (activeTab === "campaigns") {
        void loadCampaigns();
        void loadContactLists();
      } else if (activeTab === "lists") {
        void loadContactLists();
      } else if (activeTab === "automation") {
        void loadAutomation();
      } else if (activeTab === "analytics") {
        void loadAnalytics();
      }
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [
    activeTab,
    loadCampaigns,
    loadContactLists,
    loadAutomation,
    loadAnalytics,
  ]);

  async function handleSyncList(listId: string) {
    setSyncBanner(null);
    setSyncingListId(listId);
    try {
      const res = await fetch("/api/constant-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_contacts", list_id: listId }),
      });
      const json = (await res.json()) as ApiErrorJson & {
        success?: boolean;
        last_sync_at?: string;
        message?: string;
        synced?: number;
      };

      if (!res.ok) {
        setSyncBanner({
          type: "err",
          text: json.error ?? `Sync failed (${res.status})`,
        });
        return;
      }

      const iso =
        typeof json.last_sync_at === "string" ? json.last_sync_at : new Date().toISOString();
      writeStoredSync(listId, iso);
      setLastSyncByListId((m) => ({ ...m, [listId]: iso }));

      const parts = [
        typeof json.synced === "number" ? `Synced ${json.synced} contact(s).` : "Sync complete.",
        json.message,
      ].filter(Boolean);
      setSyncBanner({ type: "ok", text: parts.join(" ") });

      appendClientActivityLog({
        at: iso,
        list_id: listId,
        synced: typeof json.synced === "number" ? json.synced : 0,
        message: json.message,
      });
      setClientActivityTick((t) => t + 1);
    } catch (e) {
      setSyncBanner({
        type: "err",
        text: e instanceof Error ? e.message : "Sync failed",
      });
    } finally {
      setSyncingListId(null);
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    const fromEmail =
      typeof process.env.NEXT_PUBLIC_CC_FROM_EMAIL === "string"
        ? process.env.NEXT_PUBLIC_CC_FROM_EMAIL.trim()
        : "";
    const fromName =
      typeof process.env.NEXT_PUBLIC_CC_FROM_NAME === "string"
        ? process.env.NEXT_PUBLIC_CC_FROM_NAME.trim()
        : "MarketOS";

    if (!fromEmail) {
      setCreateError(
        "Set NEXT_PUBLIC_CC_FROM_EMAIL to a confirmed Constant Contact sender address (required by the API in addition to name, subject, and HTML).",
      );
      return;
    }

    setCreateLoading(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        email_campaign_activities: [
          {
            format_type: 5,
            from_name: fromName,
            from_email: fromEmail,
            reply_to_email: fromEmail,
            subject: subject.trim(),
            html_content: ensureTrackingHtml(htmlContent),
          },
        ],
      };
      if (selectedListIds.length > 0) {
        body.contact_list_ids = selectedListIds;
      }

      const res = await fetch("/api/constant-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as ApiErrorJson & {
        campaign_id?: string;
        name?: string;
      };

      if (!res.ok) {
        setCreateError(
          json.error ??
            (json.details ? JSON.stringify(json.details) : `Create failed (${res.status})`),
        );
        return;
      }

      setCreateSuccess(
        json.campaign_id
          ? `Draft created: ${json.name ?? name} (${json.campaign_id})`
          : "Campaign created.",
      );
      setName("");
      setSubject("");
      setHtmlContent("");
      setSelectedListIds([]);
      await loadCampaigns();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleCreateRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateRuleError(null);
    setCreateRuleLoading(true);
    try {
      const res = await fetch("/api/constant-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_automation",
          name: ruleName.trim(),
          trigger_type: ruleTrigger,
          email_sequence: ruleSequence,
          active: ruleActive,
        }),
      });
      const json = (await res.json()) as ApiErrorJson & {
        rule?: AutomationRule;
      };

      if (!res.ok) {
        setCreateRuleError(json.error ?? `Create failed (${res.status})`);
        return;
      }

      setShowCreateRule(false);
      setRuleName("");
      setRuleTrigger("intake_complete");
      setRuleSequence("");
      setRuleActive(true);
      await loadAutomation();
    } catch (err) {
      setCreateRuleError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setCreateRuleLoading(false);
    }
  }

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        activeTab === id
          ? "bg-[#1a2540] text-white ring-1 ring-[#185FA5]/50"
          : "text-slate-400 hover:bg-[#1a2540]/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: BG, fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Constant Contact</h1>
          <p className="mt-1 text-sm text-slate-400">
            Campaigns, lists, automation, and performance analytics. Data refreshes every
            30 seconds on the active tab.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 border-b border-[#2a3f5f] pb-3">
            {tabBtn("campaigns", "Campaigns")}
            {tabBtn("lists", "Lists")}
            {tabBtn("automation", "Automation")}
            {tabBtn("analytics", "Analytics")}
          </div>
        </div>

        {activeTab === "campaigns" && campaignsError ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {campaignsError}
          </div>
        ) : null}

        {activeTab === "lists" && listsError ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {listsError}
          </div>
        ) : null}

        {activeTab === "lists" && syncBanner ? (
          <div
            className={`rounded-lg border p-4 text-sm ${
              syncBanner.type === "ok"
                ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-100"
                : "border-red-900/50 bg-red-950/40 text-red-100"
            }`}
            role={syncBanner.type === "ok" ? "status" : "alert"}
          >
            {syncBanner.text}
          </div>
        ) : null}

        {activeTab === "automation" && automationError ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {automationError}
          </div>
        ) : null}

        {activeTab === "analytics" && analyticsError ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {analyticsError}
          </div>
        ) : null}

        {activeTab === "campaigns" && (
          <>
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Campaigns</h2>
                <button
                  type="button"
                  onClick={() => void loadCampaigns()}
                  disabled={campaignsLoading}
                  className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
                >
                  {campaignsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {campaignsLoading && campaigns.length === 0 ? (
                <p className="text-sm text-slate-400" aria-live="polite">
                  Loading campaigns…
                </p>
              ) : null}

              {!campaignsLoading && campaigns.length === 0 && !campaignsError ? (
                <p className="text-sm text-slate-400">No campaigns returned.</p>
              ) : null}

              {campaigns.length > 0 ? (
                <ul className="divide-y divide-[#2a3f5f]/80">
                  {campaigns.map((c, index) => {
                    const id = String(c.campaign_id ?? c.name ?? `row-${index}`);
                    return (
                      <li
                        key={id}
                        className="flex flex-col gap-1 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium text-white">{c.name ?? "Untitled"}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {c.campaign_id ? `ID: ${String(c.campaign_id)}` : null}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
                          <span>
                            Status:{" "}
                            <span className="text-slate-100">{formatStatus(c.current_status)}</span>
                          </span>
                          <span className="tabular-nums text-slate-400">
                            Created:{" "}
                            {formatDate(
                              typeof c.created_at === "string" ? c.created_at : undefined,
                            )}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-1 text-lg font-semibold">Create campaign</h2>
              <p className="mb-4 text-sm text-slate-400">
                Sends a <span className="text-slate-300">POST /emails</span> draft (custom code).
                Sender must come from{" "}
                <code className="rounded bg-[#0f1729] px-1 text-xs text-[#94a3b8]">
                  NEXT_PUBLIC_CC_FROM_EMAIL
                </code>{" "}
                (and optionally{" "}
                <code className="rounded bg-[#0f1729] px-1 text-xs text-[#94a3b8]">
                  NEXT_PUBLIC_CC_FROM_NAME
                </code>
                ).
              </p>

              {createError ? (
                <div
                  className="mb-4 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-100"
                  role="alert"
                >
                  {createError}
                </div>
              ) : null}

              {createSuccess ? (
                <div
                  className="mb-4 rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-3 text-sm text-emerald-100"
                  role="status"
                >
                  {createSuccess}
                </div>
              ) : null}

              <form className="space-y-4" onSubmit={(e) => void handleCreate(e)}>
                <div>
                  <label htmlFor="cc-name" className="block text-sm font-medium text-slate-300">
                    Name
                  </label>
                  <input
                    id="cc-name"
                    name="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                    style={{ borderColor: BORDER }}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="cc-subject" className="block text-sm font-medium text-slate-300">
                    Subject
                  </label>
                  <input
                    id="cc-subject"
                    name="subject"
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="cc-html" className="block text-sm font-medium text-slate-300">
                    HTML content
                  </label>
                  <textarea
                    id="cc-html"
                    name="html_content"
                    required
                    rows={8}
                    value={htmlContent}
                    onChange={(e) => setHtmlContent(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 font-mono text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                    placeholder="<p>Hello…</p>"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    If you omit <code className="text-slate-400">[[trackingImage]]</code>, it is
                    prepended automatically for opens tracking.
                  </p>
                </div>

                <div>
                  <span className="block text-sm font-medium text-slate-300">
                    Lists (optional)
                  </span>
                  {listsLoading && contactLists.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500" aria-live="polite">
                      Loading contact lists for selection…
                    </p>
                  ) : contactLists.length > 0 ? (
                    <>
                      <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-md border border-[#2a3f5f] bg-[#0f1729] p-3">
                        {contactLists.map((list) => {
                          const id = list.list_id ? String(list.list_id) : "";
                          if (!id) return null;
                          return (
                            <li key={id}>
                              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={selectedListIds.includes(id)}
                                  onChange={() => toggleCampaignList(id)}
                                  className="mt-1 h-4 w-4 rounded border-[#2a3f5f] bg-[#0f1729] text-[#185FA5] focus:ring-[#185FA5]"
                                />
                                <span>
                                  {list.name ?? id}
                                  {typeof list.membership_count === "number" ? (
                                    <span className="text-slate-500">
                                      {" "}
                                      ({list.membership_count.toLocaleString()} contacts)
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-xs text-slate-500">
                        Selected lists are sent as{" "}
                        <code className="text-slate-400">contact_list_ids</code> on create.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      No lists available yet. Check the Lists tab or your Constant Contact
                      account.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={createLoading}
                  className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {createLoading ? "Creating…" : "Create draft campaign"}
                </button>
              </form>
            </section>
          </>
        )}

        {activeTab === "lists" && (
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Contact lists</h2>
              <button
                type="button"
                onClick={() => void loadContactLists()}
                disabled={listsLoading}
                className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
              >
                {listsLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {listsLoading && contactLists.length === 0 ? (
              <p className="text-sm text-slate-400" aria-live="polite">
                Loading lists…
              </p>
            ) : null}

            {!listsLoading && contactLists.length === 0 && !listsError ? (
              <p className="text-sm text-slate-400">No contact lists returned.</p>
            ) : null}

            {contactLists.length > 0 ? (
              <ul className="divide-y divide-[#2a3f5f]/80">
                {contactLists.map((row, index) => {
                  const id = row.list_id ? String(row.list_id) : `list-${index}`;
                  const listId = row.list_id ? String(row.list_id) : "";
                  const desc =
                    typeof row.description === "string" && row.description.trim()
                      ? row.description
                      : "—";
                  const count =
                    typeof row.membership_count === "number"
                      ? row.membership_count.toLocaleString()
                      : "—";
                  const lastSync = listId ? lastSyncByListId[listId] : undefined;

                  return (
                    <li key={id} className="flex flex-col gap-3 py-5 first:pt-0 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium text-white">{row.name ?? "Untitled list"}</p>
                        <p className="text-sm text-slate-400">
                          <span className="text-slate-300">Contacts:</span> {count}
                        </p>
                        <p className="text-sm text-slate-400">
                          <span className="text-slate-300">Description:</span> {desc}
                        </p>
                        <p className="text-xs text-slate-500">
                          Last sync:{" "}
                          {lastSync ? formatDate(lastSync) : "—"}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <button
                          type="button"
                          disabled={!listId || syncingListId !== null}
                          onClick={() => listId && void handleSyncList(listId)}
                          className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-100 hover:bg-[#1a2540] disabled:opacity-50"
                          style={
                            syncingListId === listId
                              ? { borderColor: ACCENT, color: "#fff" }
                              : undefined
                          }
                        >
                          {syncingListId === listId ? "Syncing…" : "Sync from CMS"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        )}

        {activeTab === "automation" && (
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Automation rules</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadAutomation()}
                  disabled={automationLoading}
                  className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
                >
                  {automationLoading ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateRule((v) => !v);
                    setCreateRuleError(null);
                  }}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  {showCreateRule ? "Close form" : "Create Rule"}
                </button>
              </div>
            </div>

            {showCreateRule ? (
              <form
                className="mb-8 space-y-4 rounded-lg border border-[#2a3f5f] bg-[#0f1729]/50 p-4"
                onSubmit={(e) => void handleCreateRule(e)}
              >
                <h3 className="text-base font-semibold text-white">New rule</h3>
                {createRuleError ? (
                  <div
                    className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-100"
                    role="alert"
                  >
                    {createRuleError}
                  </div>
                ) : null}
                <div>
                  <label htmlFor="rule-name" className="block text-sm font-medium text-slate-300">
                    Name
                  </label>
                  <input
                    id="rule-name"
                    name="rule_name"
                    type="text"
                    required
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="rule-trigger" className="block text-sm font-medium text-slate-300">
                    Trigger type
                  </label>
                  <select
                    id="rule-trigger"
                    name="trigger_type"
                    value={ruleTrigger}
                    onChange={(e) =>
                      setRuleTrigger(e.target.value as AutomationTrigger)
                    }
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                  >
                    {AUTOMATION_TRIGGERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rule-sequence" className="block text-sm font-medium text-slate-300">
                    Email sequence
                  </label>
                  <textarea
                    id="rule-sequence"
                    name="email_sequence"
                    rows={6}
                    value={ruleSequence}
                    onChange={(e) => setRuleSequence(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 font-mono text-sm text-white outline-none ring-[#185FA5] focus:ring-2"
                    placeholder={"Day 0: Welcome email\nDay 3: Follow-up\nDay 7: Check-in"}
                  />
                  <p className="mt-1 text-xs text-slate-500">One line per step: Day X: Subject line</p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={ruleActive}
                    onChange={(e) => setRuleActive(e.target.checked)}
                    className="h-4 w-4 rounded border-[#2a3f5f] bg-[#0f1729] text-[#185FA5] focus:ring-[#185FA5]"
                  />
                  Active
                </label>
                <button
                  type="submit"
                  disabled={createRuleLoading}
                  className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {createRuleLoading ? "Saving…" : "Save rule"}
                </button>
              </form>
            ) : null}

            {automationLoading && automationRules.length === 0 ? (
              <p className="text-sm text-slate-400" aria-live="polite">
                Loading automation rules…
              </p>
            ) : null}

            {!automationLoading &&
            automationRules.length === 0 &&
            !automationError ? (
              <p className="text-sm text-slate-400">No automation rules yet.</p>
            ) : null}

            {automationRules.length > 0 ? (
              <ul className="divide-y divide-[#2a3f5f]/80">
                {automationRules.map((row, index) => {
                  const id = String(row.id ?? `rule-${index}`);
                  const seqCount =
                    typeof row.sequence_count === "number"
                      ? row.sequence_count
                      : typeof row.email_sequence === "string"
                        ? row.email_sequence
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean).length
                        : 0;
                  const active =
                    typeof row.active === "boolean" ? row.active : false;
                  return (
                    <li key={id} className="py-4 first:pt-0">
                      <p className="font-medium text-white">{row.name ?? "Untitled rule"}</p>
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
                        <span>
                          <span className="text-slate-500">Trigger:</span>{" "}
                          <span className="text-slate-200">
                            {row.trigger_type ?? "—"}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">Status:</span>{" "}
                          <span className={active ? "text-emerald-300" : "text-slate-500"}>
                            {active ? "Active" : "Inactive"}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">Emails in sequence:</span>{" "}
                          <span className="tabular-nums text-slate-200">{seqCount}</span>
                        </span>
                      </div>
                      {typeof row.email_sequence === "string" &&
                      row.email_sequence.trim() ? (
                        <pre
                          className="mt-3 max-h-36 overflow-auto rounded border border-[#2a3f5f]/70 bg-[#0f1729]/80 p-3 font-mono text-xs whitespace-pre-wrap text-slate-400"
                          tabIndex={0}
                        >
                          {row.email_sequence}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-8">
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Performance overview</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Last updated:{" "}
                    {analyticsGeneratedAt ? formatDate(analyticsGeneratedAt) : "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAnalytics()}
                  disabled={analyticsLoading}
                  className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
                >
                  {analyticsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {analyticsLoading && !analyticsSummary ? (
                <p className="text-sm text-slate-400" aria-live="polite">
                  Loading analytics…
                </p>
              ) : null}

              {analyticsSummary ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <article
                    className="rounded-lg border border-[#2a3f5f]/80 p-4"
                    style={{ backgroundColor: "#0f1729" }}
                  >
                    <p className="text-sm text-slate-400">Total campaigns</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                      {analyticsSummary.total_campaigns.toLocaleString()}
                    </p>
                  </article>
                  <article
                    className="rounded-lg border border-[#2a3f5f]/80 p-4"
                    style={{ backgroundColor: "#0f1729" }}
                  >
                    <p className="text-sm text-slate-400">Total contacts</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                      {analyticsSummary.total_contacts.toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Across contact lists</p>
                  </article>
                  <article
                    className="rounded-lg border border-[#2a3f5f]/80 p-4"
                    style={{ backgroundColor: "#0f1729" }}
                  >
                    <p className="text-sm text-slate-400">Total opens</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                      {analyticsSummary.total_opens.toLocaleString()}
                    </p>
                    <p
                      className={`mt-1 text-xs font-medium tabular-nums ${openRateColor(
                        analyticsSummary.overall_open_rate,
                      )}`}
                    >
                      Open rate (opens ÷ sent):{" "}
                      {formatPct(analyticsSummary.overall_open_rate)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Clicks: {analyticsSummary.total_clicks.toLocaleString()} (
                      {formatPct(analyticsSummary.overall_click_rate)})
                    </p>
                  </article>
                  <article
                    className="rounded-lg border border-[#2a3f5f]/80 p-4"
                    style={{ backgroundColor: "#0f1729" }}
                  >
                    <p className="text-sm text-slate-400">Revenue generated</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">
                      {formatUsd(analyticsSummary.revenue_generated)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      From CMS attribution when configured
                    </p>
                  </article>
                </div>
              ) : null}

              {chartRows.length > 0 ? (
                <div className="mt-8">
                  <h3 className="mb-3 text-base font-semibold text-white">
                    Opens & clicks (recent campaigns)
                  </h3>
                  <div className="h-[300px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartRows}
                        margin={{ top: 8, right: 12, left: 8, bottom: 56 }}
                      >
                        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: "#94a3b8", fontSize: 9 }}
                          interval={0}
                          angle={-30}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: CARD,
                            border: `1px solid ${BORDER}`,
                            color: "#fff",
                          }}
                        />
                        <Legend />
                        <Bar dataKey="Opens" fill={ACCENT} name="Opens" />
                        <Bar dataKey="Clicks" fill="#1D9E75" name="Clicks" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Recent campaign performance</h2>
              {analyticsLoading && sortedPerformanceRows.length === 0 ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : null}
              {!analyticsLoading && sortedPerformanceRows.length === 0 && !analyticsError ? (
                <p className="text-sm text-slate-400">No campaign metrics available yet.</p>
              ) : null}
              {sortedPerformanceRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#2a3f5f] text-slate-400">
                        <th className="pb-3 pr-4 font-medium">Campaign</th>
                        <th className="pb-3 pr-4 font-medium">Send date</th>
                        <th className="pb-3 pr-4 font-medium tabular-nums">Opens</th>
                        <th className="pb-3 pr-4 font-medium tabular-nums">Clicks</th>
                        <th className="pb-3 pr-4 font-medium tabular-nums">Open rate</th>
                        <th className="pb-3 font-medium tabular-nums">Click rate</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {sortedPerformanceRows.map((row) => (
                        <tr key={row.campaign_id} className="border-b border-[#2a3f5f]/50">
                          <td className="py-2 pr-4 text-white">{row.campaign_name}</td>
                          <td className="py-2 pr-4 text-slate-400">
                            {row.send_date ? formatDate(row.send_date) : "—"}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{row.opens.toLocaleString()}</td>
                          <td className="py-2 pr-4 tabular-nums">{row.clicks.toLocaleString()}</td>
                          <td
                            className={`py-2 pr-4 tabular-nums font-medium ${openRateColor(
                              row.open_rate,
                            )}`}
                          >
                            {formatPct(row.open_rate)}
                          </td>
                          <td
                            className={`py-2 tabular-nums font-medium ${clickRateColor(
                              row.click_rate,
                            )}`}
                          >
                            {formatPct(row.click_rate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Sync activity</h2>
              <p className="mb-3 text-xs text-slate-500">
                Server log (Supabase) plus this browser&apos;s recent CMS syncs.
              </p>
              {mergedSyncActivity.length === 0 ? (
                <p className="text-sm text-slate-400">No sync activity recorded yet.</p>
              ) : (
                <ul className="divide-y divide-[#2a3f5f]/80">
                  {mergedSyncActivity.map((row, i) => (
                    <li key={`${row.at}-${row.list_id}-${i}`} className="py-3 first:pt-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-white">
                          List{" "}
                          <span className="font-mono text-xs text-slate-400">
                            {row.list_id ?? "—"}
                          </span>
                        </p>
                        <span className="text-xs text-slate-500">
                          {formatDate(row.at)} ·{" "}
                          <span
                            className={
                              row.source === "server" ? "text-sky-400" : "text-slate-400"
                            }
                          >
                            {row.source === "server" ? "Server" : "This device"}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">
                        Synced{" "}
                        <span className="tabular-nums text-slate-200">
                          {row.synced_count.toLocaleString()}
                        </span>{" "}
                        contact(s)
                        {row.message ? (
                          <span className="block text-xs text-slate-500">{row.message}</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
