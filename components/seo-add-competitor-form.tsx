"use client";

import { useState } from "react";
import Link from "next/link";

export function SeoAddCompetitorForm() {
  const [domain, setDomain] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/competitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const body = (await res.json()) as { added?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not add competitor.");
        return;
      }
      setMessage(`Added ${body.added}`);
      setDomain("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add competitor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-2xl rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
      <label className="block text-sm text-slate-300">
        Competitor domain
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="examplelawfirm.com"
          className="mt-2 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
        />
      </label>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={loading || !domain.trim()}
        className="mt-3 rounded bg-[#185FA5] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Adding..." : "Add competitor"}
      </button>
      {message ? <p className="mt-3 text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      <div className="mt-5 text-xs text-slate-400">
        Added domains become available across competitor dashboard views immediately for this app instance.
      </div>
      <Link href="/seo/competitors" className="mt-4 inline-block text-xs text-sky-300 underline">
        Back to competitor dashboard
      </Link>
    </section>
  );
}

