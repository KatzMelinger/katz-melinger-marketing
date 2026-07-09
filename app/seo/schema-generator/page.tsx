"use client";

/**
 * Schema generator — curated Schema.org template → AI-filled JSON-LD →
 * one-click queue for AutoPilot.
 *
 * Same shape as the AutoPilot-fix flow on /seo/technical: the marketer fills
 * in a form, we ask Claude to compose the JSON-LD, the result is previewable
 * + copyable + queueable. Queueing inserts a wp_autopilot_recommendations
 * row with fix_type='schema_jsonld' so the WP plugin injects it on the
 * target page.
 */

import { useMemo, useState } from "react";

import {
  SCHEMA_TEMPLATES,
  type SchemaTemplate,
  type TemplateField,
} from "@/lib/schema-templates";

type QaPair = { question: string; answer: string };

type GeneratedSchema = {
  jsonld: Record<string, unknown>;
  jsonld_string: string;
  schemaType: string;
  pageUrl: string;
  rationale: string;
};

function emptyParamsForTemplate(template: SchemaTemplate) {
  const out: Record<string, unknown> = {};
  for (const f of template.fields) {
    if (f.kind === "list" || f.kind === "breadcrumbs") out[f.key] = "";
    else if (f.kind === "qa_pairs") out[f.key] = [{ question: "", answer: "" }];
    else out[f.key] = "";
  }
  return out;
}

export default function SchemaGeneratorPage() {
  const [templateId, setTemplateId] = useState(SCHEMA_TEMPLATES[0].id);
  const template = useMemo(
    () =>
      SCHEMA_TEMPLATES.find((t) => t.id === templateId) ?? SCHEMA_TEMPLATES[0],
    [templateId],
  );
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    emptyParamsForTemplate(SCHEMA_TEMPLATES[0]),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedSchema | null>(null);
  const [queued, setQueued] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suggestingQa, setSuggestingQa] = useState(false);
  const [qaSuggestError, setQaSuggestError] = useState<string | null>(null);

  function changeTemplate(id: string) {
    const next =
      SCHEMA_TEMPLATES.find((t) => t.id === id) ?? SCHEMA_TEMPLATES[0];
    setTemplateId(id);
    setParams(emptyParamsForTemplate(next));
    setResult(null);
    setError(null);
    setQueued(false);
  }

  function updateField(key: string, value: unknown) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  // For qa_pairs: payload to API is the full array. For list / breadcrumbs the
  // textarea string gets split before sending.
  function buildPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of template.fields) {
      const raw = params[f.key];
      if (f.kind === "list") {
        const lines = typeof raw === "string" ? raw : "";
        out[f.key] = lines
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (f.kind === "breadcrumbs") {
        // Same as list — we let Claude pair "Name | URL" or just plain names.
        const lines = typeof raw === "string" ? raw : "";
        out[f.key] = lines
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (f.kind === "qa_pairs") {
        out[f.key] = Array.isArray(raw)
          ? (raw as QaPair[]).filter(
              (p) => p.question.trim() && p.answer.trim(),
            )
          : [];
      } else {
        out[f.key] = typeof raw === "string" ? raw : "";
      }
    }
    return out;
  }

  async function suggestQaFromPage() {
    const pageUrl =
      typeof params.pageUrl === "string" ? params.pageUrl.trim() : "";
    if (!pageUrl) {
      setQaSuggestError("Fill in the page URL above first.");
      return;
    }
    setQaSuggestError(null);
    setSuggestingQa(true);
    try {
      const res = await fetch("/api/seo/schema-generator/suggest-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pageUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Suggestion failed");
      const pairs = (json.pairs as QaPair[] | undefined) ?? [];
      if (pairs.length === 0) {
        setQaSuggestError("Claude didn't find anything to ground Q&A in.");
        return;
      }
      // Replace whatever's in the qa field with the suggested pairs.
      updateField("qa", pairs);
    } catch (e) {
      setQaSuggestError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggestingQa(false);
    }
  }

  async function generate() {
    setError(null);
    setResult(null);
    setQueued(false);
    setLoading(true);
    try {
      const res = await fetch("/api/seo/schema-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, params: buildPayload() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Generation failed");
      setResult(json as GeneratedSchema);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function copyJsonLd() {
    if (!result) return;
    await navigator.clipboard.writeText(result.jsonld_string);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function queueForAutoPilot() {
    if (!result) return;
    setQueuing(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/technical/queue-fixes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_url: result.pageUrl,
          fixes: [
            {
              fix_type: "schema_jsonld",
              current_value: "",
              suggested_value: result.jsonld_string,
              rationale:
                result.rationale ||
                `Add ${result.schemaType} structured data so search + AI overviews can parse the page.`,
            },
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Queue failed");
      setQueued(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Queue failed");
    } finally {
      setQueuing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          SEO Ops Hub / Schema generator
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Schema generator
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Pick a Schema.org template, fill in a few fields, and Claude composes
          valid JSON-LD using the firm context. Queue it for AutoPilot to push
          live, or copy/paste it manually.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-slate-800">
          Template
        </label>
        <select
          value={templateId}
          onChange={(e) => changeTemplate(e.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        >
          {SCHEMA_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.schemaType})
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-500">{template.description}</p>

        <div className="mt-5 space-y-5">
          {template.fields.map((f) => (
            <div key={f.key}>
              <FieldRow
                field={f}
                value={params[f.key]}
                onChange={(v) => updateField(f.key, v)}
              />
              {template.id === "faq_page" && f.kind === "qa_pairs" && (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={suggestQaFromPage}
                    disabled={suggestingQa}
                    className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                  >
                    {suggestingQa
                      ? "Reading page…"
                      : "Suggest Q&A from page"}
                  </button>
                  <span className="text-xs text-slate-500">
                    Fetches the URL above and drafts Q&amp;A grounded in the
                    page text. You can edit each one before generating.
                  </span>
                </div>
              )}
              {qaSuggestError &&
                template.id === "faq_page" &&
                f.kind === "qa_pairs" && (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {qaSuggestError}
                  </div>
                )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate JSON-LD"}
          </button>
          {loading && (
            <span className="text-sm text-slate-500">5–15 seconds.</span>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </section>

      {result && (
        <section className="mt-6 rounded-lg border border-violet-200 bg-violet-50/30 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {result.schemaType} for{" "}
                <a
                  href={result.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-700 underline-offset-2 hover:underline"
                >
                  {result.pageUrl}
                </a>
              </h2>
              {result.rationale && (
                <p className="mt-1 text-xs italic text-slate-600">
                  {result.rationale}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={copyJsonLd}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
              >
                {copied ? "Copied ✓" : "Copy JSON-LD"}
              </button>
              <button
                type="button"
                onClick={queueForAutoPilot}
                disabled={queued || queuing}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  queued
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                }`}
              >
                {queued
                  ? "Queued ✓"
                  : queuing
                    ? "Queuing…"
                    : "Queue for AutoPilot"}
              </button>
            </div>
          </div>

          <pre className="mt-4 max-h-[500px] overflow-auto rounded-md border border-slate-200 bg-white p-3 text-xs leading-snug text-slate-800">
{result.jsonld_string}
          </pre>
        </section>
      )}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const baseLabel = (
    <label
      htmlFor={field.key}
      className="block text-sm font-semibold text-slate-800"
    >
      {field.label}
      {field.required && <span className="ml-1 text-red-600">*</span>}
    </label>
  );
  if (field.kind === "text" || field.kind === "url") {
    return (
      <div>
        {baseLabel}
        {field.hint && <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>}
        <input
          id={field.key}
          type={field.kind === "url" ? "url" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>
    );
  }
  if (field.kind === "textarea") {
    return (
      <div>
        {baseLabel}
        {field.hint && <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>}
        <textarea
          id={field.key}
          rows={4}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>
    );
  }
  if (field.kind === "list" || field.kind === "breadcrumbs") {
    return (
      <div>
        {baseLabel}
        {field.hint && <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>}
        <textarea
          id={field.key}
          rows={4}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>
    );
  }
  if (field.kind === "qa_pairs") {
    const pairs = (Array.isArray(value) ? (value as QaPair[]) : []).slice();
    if (pairs.length === 0) pairs.push({ question: "", answer: "" });
    return (
      <div>
        {baseLabel}
        {field.hint && <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>}
        <div className="mt-2 space-y-3">
          {pairs.map((p, i) => (
            <div
              key={i}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <input
                type="text"
                value={p.question}
                placeholder="Question"
                onChange={(e) => {
                  const next = pairs.slice();
                  next[i] = { ...next[i], question: e.target.value };
                  onChange(next);
                }}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <textarea
                rows={2}
                value={p.answer}
                placeholder="Answer"
                onChange={(e) => {
                  const next = pairs.slice();
                  next[i] = { ...next[i], answer: e.target.value };
                  onChange(next);
                }}
                className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              {pairs.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = pairs.filter((_, idx) => idx !== i);
                    onChange(
                      next.length > 0
                        ? next
                        : [{ question: "", answer: "" }],
                    );
                  }}
                  className="mt-2 text-xs text-red-700 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...pairs, { question: "", answer: "" }])}
            className="text-xs font-medium text-violet-700 hover:underline"
          >
            + Add another Q&amp;A
          </button>
        </div>
      </div>
    );
  }
  return null;
}
