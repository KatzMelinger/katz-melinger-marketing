"use client";

/**
 * WordPress connection manager.
 *
 * Generates and manages the per-domain AutoPilot bearer tokens that the "KM
 * AutoPilot" WordPress plugin uses to authenticate. The dashboard generates
 * on-page SEO fixes (meta, schema, canonicals, …); the plugin polls
 * `/api/wp/recommendations` with one of these tokens, applies the approved
 * fixes to the live site, and confirms back via `/api/wp/applied`.
 *
 * Tokens are tenant-scoped server-side (the API stamps tenant_id from the
 * session), so whoever is logged in only ever sees / mints tokens for their
 * own firm. The raw token is shown exactly once at creation — only its sha256
 * hash is stored — so the UI surfaces a copy affordance immediately.
 */

import { useCallback, useEffect, useState } from "react";

type TokenRow = {
  id: string;
  domain: string;
  label: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function normalizeDomainInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function WordPressSettingsPage() {
  const [domain, setDomain] = useState("");
  const [touchedDomain, setTouchedDomain] = useState(false);
  const [label, setLabel] = useState("Production");

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The freshly-minted raw token, shown once below the form.
  const [freshToken, setFreshToken] = useState<{ token: string; domain: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Prefill the domain from the tenant's primary site (if the API exposes one)
  // until the user edits the field. Gracefully no-ops when /api/auth/me doesn't
  // return a domain.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || touchedDomain) return;
        const dom = typeof d?.domain === "string" ? d.domain : "";
        if (dom) setDomain(normalizeDomainInput(dom));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once on mount; the touchedDomain guard prevents clobbering user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wp/tokens", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load tokens");
      setTokens(Array.isArray(json?.tokens) ? json.tokens : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const d = normalizeDomainInput(domain);
    if (!d.includes(".")) {
      setError("Enter a valid site domain, e.g. example.com");
      return;
    }
    setCreating(true);
    setError(null);
    setFreshToken(null);
    setCopied(false);
    try {
      const res = await fetch("/api/wp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d, label: label.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to create token");
      setFreshToken({ token: json.token, domain: json.domain });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this token? The WordPress site using it will stop receiving fixes until you connect a new token.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/wp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to revoke token");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke token");
    }
  };

  const copy = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; user can select manually */
    }
  };

  // The plugin's "Dashboard base URL" field takes the ORIGIN only — it appends
  // `/api/wp/recommendations` (and the other API paths) itself. Don't include a path.
  const pollUrl =
    typeof window !== "undefined" ? window.location.origin : "https://katz-melinger-marketing.vercel.app";

  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Connect WordPress</h1>
      <p className="mt-2 text-sm text-slate-600">
        Connect a client&apos;s existing WordPress site so the dashboard can push approved on-page SEO
        fixes (meta titles &amp; descriptions, canonicals, schema/JSON-LD, H1s, OG tags, internal links,
        alt text) to it automatically. Generate a token below, then paste it into the KM AutoPilot
        plugin on the WordPress site.
      </p>

      {/* Step 1 — generate a token */}
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
            1
          </span>
          Generate a connection token
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Site domain</span>
            <input
              type="text"
              value={domain}
              onChange={(e) => {
                setTouchedDomain(true);
                setDomain(e.target.value);
              }}
              placeholder="example.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Production"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {creating ? "Generating…" : "Generate token"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        {freshToken && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-xs font-semibold text-amber-800">
              Copy this token now — it is shown only once and cannot be retrieved later.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-slate-800">
                {freshToken.token}
              </code>
              <button
                onClick={copy}
                className="shrink-0 rounded-md border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              For <span className="font-medium">{freshToken.domain}</span>. Paste it into the KM AutoPilot
              plugin in step 2.
            </p>
          </div>
        )}
      </section>

      {/* Step 2 — install the plugin */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
            2
          </span>
          Connect the WordPress site
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>Install &amp; activate the KM AutoPilot plugin on the WordPress site.</li>
          <li>
            In the plugin settings, set the <span className="font-medium">Dashboard base URL</span> to:
            <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
              {pollUrl}
            </code>
            <span className="ml-1 text-xs text-slate-500">(base URL only — no path; the plugin adds the rest)</span>
          </li>
          <li>Paste the token from step 1 and save.</li>
          <li>
            The plugin polls every ~15&nbsp;minutes for <span className="font-medium">approved</span> fixes,
            applies them, then confirms back. Approve fixes from the SEO tools (e.g. Technical SEO) to queue
            them.
          </li>
        </ol>
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Don&apos;t have the KM AutoPilot plugin yet? It ships separately from this dashboard — the token
          and endpoints above are everything it needs to connect.
        </p>
      </section>

      {/* Existing tokens */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Connected tokens</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : active.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No active tokens yet. Generate one above to connect a site.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {active.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                    <span className="truncate text-sm font-medium text-slate-800">{t.domain}</span>
                    {t.label && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                        {t.label}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Created {fmtDate(t.created_at)} · Last used {fmtDate(t.last_used_at)}
                  </div>
                </div>
                <button
                  onClick={() => revoke(t.id)}
                  className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        {revoked.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
              {revoked.length} revoked token{revoked.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {revoked.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2 text-xs text-slate-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-slate-300" aria-hidden />
                  <span className="truncate">{t.domain}</span>
                  {t.label && <span>· {t.label}</span>}
                  <span className="ml-auto">revoked {fmtDate(t.revoked_at)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </main>
  );
}
