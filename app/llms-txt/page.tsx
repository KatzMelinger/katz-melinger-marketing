"use client";

/**
 * llms.txt generator.
 *
 * Crawls the firm's sitemap, builds a curated llms.txt manifest grouped by
 * section (Practice Areas, About, Insights, etc), and lets the user copy it
 * straight to their site root. Each generation is logged so the version
 * history shows what was sent to LLMs over time.
 */

import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing-nav";

type Version = {
  id: string;
  domain: string;
  content: string;
  source_pages: { url: string; title: string; section: string }[];
  created_at: string;
};

export default function LlmsTxtPage() {
  const [url, setUrl] = useState("https://www.katzmelinger.com");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [pages, setPages] = useState<{ url: string; title: string; section: string }[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshVersions = async () => {
    const res = await fetch("/api/llms-txt/versions");
    const data = await res.json();
    setVersions(data.versions ?? []);
    if (!content && data.versions?.[0]) {
      setContent(data.versions[0].content);
      setPages(data.versions[0].source_pages ?? []);
    }
  };

  useEffect(() => {
    refreshVersions();
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/llms-txt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setContent(data.content);
      setPages(data.sourcePages ?? []);
      refreshVersions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    }
    setGenerating(false);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <MarketingNav />
      <div className="p-6 space-y-6 mx-auto max-w-7xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">llms.txt generator</h1>
        <p className="text-sm opacity-70 mt-1 max-w-2xl">
          Build a curated <code className="text-xs px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">llms.txt</code> manifest
          for the firm's site. LLMs that respect the spec use it to find your
          most important pages. Paste the output at <code className="text-xs">/llms.txt</code> on your site.
        </p>
      </div>

      <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-transparent text-sm"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-foreground text-background disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>

      {content && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 border border-black/10 dark:border-white/10 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-black/10 dark:border-white/10 text-xs">
              <span className="font-mono opacity-70">/llms.txt</span>
              <button
                onClick={copy}
                className="px-2 py-1 rounded border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="p-4 text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">
              {content}
            </pre>
          </div>
          <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
            <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
              Source pages ({pages.length})
            </div>
            <ul className="space-y-1.5 text-xs">
              {pages.map((p) => (
                <li key={p.url} className="flex justify-between gap-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="truncate underline opacity-90">
                    {p.title}
                  </a>
                  <span className="opacity-60 shrink-0">{p.section}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider opacity-70 mb-2">Version history</div>
        <div className="space-y-1.5 text-sm">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3">
              <span className="opacity-70">{new Date(v.created_at).toLocaleString()}</span>
              <span className="opacity-60">{v.domain}</span>
              <span className="opacity-60">{v.source_pages?.length ?? 0} pages</span>
              <button
                onClick={() => {
                  setContent(v.content);
                  setPages(v.source_pages ?? []);
                }}
                className="ml-auto text-xs px-2 py-1 rounded border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
              >
                Load
              </button>
            </div>
          ))}
          {versions.length === 0 && (
            <p className="opacity-60 text-xs">No versions yet — click Generate.</p>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
