"use client";

import { useCallback, useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

const DEFAULT_BRAND_VOICE =
  "Katz Melinger PLLC is a plaintiff-side employment law firm in New York City. We represent workers in wage theft, discrimination, harassment, and wrongful termination cases. Our tone is professional but approachable, empathetic to workers, and focused on justice. We avoid legal jargon when communicating with clients. We are aggressive advocates but communicate with warmth and clarity.";

const PRACTICE_AREAS = [
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
  "General",
] as const;

export default function ContentPage() {
  const [tab, setTab] = useState<"blog" | "social" | "email">("blog");
  const [topic, setTopic] = useState("");
  const [practiceArea, setPracticeArea] = useState("General");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [tone, setTone] = useState("Professional");
  const [platform, setPlatform] = useState("linkedin");
  const [campaignType, setCampaignType] = useState("Newsletter");
  const [preview, setPreview] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [brandVoice, setBrandVoice] = useState("");
  const [brandLoading, setBrandLoading] = useState(false);

  const loadBrand = useCallback(async () => {
    const res = await fetch("/api/content/brand-voice");
    const j = await res.json();
    const ctx = typeof j.context === "string" ? j.context.trim() : "";
    setBrandVoice(ctx || DEFAULT_BRAND_VOICE);
  }, []);

  useEffect(() => {
    void loadBrand();
  }, [loadBrand]);

  async function generate() {
    setLoading(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const body: Record<string, unknown> = {
        content_type: tab === "blog" ? "blog" : tab === "social" ? "social" : "email",
        topic,
        practice_area: practiceArea,
        tone,
        length: tab === "blog" ? length : "short",
      };
      if (tab === "social") body.platform = platform;
      if (tab === "email") body.campaign_type = campaignType;

      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Generation failed");
        return;
      }
      if (tab === "email") {
        setEmailSubject(typeof j.subject === "string" ? j.subject : "");
        setPreview(typeof j.body === "string" ? j.body : j.raw ?? "");
      } else {
        setPreview(typeof j.content === "string" ? j.content : "");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function saveBlog() {
    if (!preview.trim()) return;
    setSavedMsg(null);
    const res = await fetch("/api/content/social-posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "blog",
        title: topic.slice(0, 200) || "Blog draft",
        body: preview,
      }),
    });
    if (res.ok) setSavedMsg("Saved to Supabase.");
    else setSavedMsg("Save failed.");
  }

  async function saveBrandVoice() {
    setBrandLoading(true);
    try {
      const res = await fetch("/api/content/brand-voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: brandVoice }),
      });
      if (res.ok) setSavedMsg("Brand voice saved.");
      else setSavedMsg("Could not save brand voice.");
    } finally {
      setBrandLoading(false);
    }
  }

  const socialChars = preview.length;
  const platformHint =
    platform === "linkedin"
      ? "Professional tone; first-person firm voice; 1–3 short paragraphs."
      : platform === "x"
        ? "Concise; strong hook; stay within 280 characters if possible."
        : platform === "instagram"
          ? "Line breaks; emoji sparingly; clear CTA."
          : "Engaging; community-focused; link in comments if needed.";

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Content studio</h1>
          <p className="mt-1 text-sm text-slate-400">AI drafts · Katz Melinger voice</p>
        </div>

        <div className="flex flex-wrap gap-2 border-b pb-2" style={{ borderColor: BORDER }}>
          {(
            [
              ["blog", "Blog posts"],
              ["social", "Social media"],
              ["email", "Email campaigns"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                tab === id ? "text-white" : "text-slate-400 hover:text-white"
              }`}
              style={{
                backgroundColor: tab === id ? ACCENT : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
            {tab === "social" ? (
              <label className="block text-sm">
                <span className="text-xs text-slate-400">Platform</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  <option value="linkedin">LinkedIn</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="x">X</option>
                </select>
                <p className="mt-2 text-xs text-slate-500">{platformHint}</p>
              </label>
            ) : null}

            {tab === "email" ? (
              <label className="block text-sm">
                <span className="text-xs text-slate-400">Campaign type</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={campaignType}
                  onChange={(e) => setCampaignType(e.target.value)}
                >
                  <option>Newsletter</option>
                  <option>Case update</option>
                  <option>Holiday</option>
                  <option>Referral thank you</option>
                </select>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="text-xs text-slate-400">Topic</span>
              <input
                className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What should this piece cover?"
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-400">Practice area</span>
              <select
                className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value)}
              >
                {PRACTICE_AREAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            {tab === "blog" ? (
              <>
                <label className="block text-sm">
                  <span className="text-xs text-slate-400">Length</span>
                  <select
                    className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                    value={length}
                    onChange={(e) =>
                      setLength(e.target.value as "short" | "medium" | "long")
                    }
                  >
                    <option value="short">Short (~500 words)</option>
                    <option value="medium">Medium (~1000 words)</option>
                    <option value="long">Long (~2000 words)</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-xs text-slate-400">Tone</span>
                  <select
                    className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                  >
                    <option>Professional</option>
                    <option>Conversational</option>
                    <option>Urgent</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="block text-sm">
                <span className="text-xs text-slate-400">Tone</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option>Professional</option>
                  <option>Conversational</option>
                  <option>Urgent</option>
                </select>
              </label>
            )}

            {err ? <p className="text-sm text-rose-300">{err}</p> : null}

            <button
              type="button"
              disabled={loading || !topic.trim()}
              onClick={() => void generate()}
              className="w-full rounded-lg py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? "Generating…" : "Generate"}
            </button>
          </section>

          <section className="space-y-3 rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
            <h2 className="text-sm font-semibold text-white">Preview</h2>
            {tab === "email" && emailSubject ? (
              <div className="rounded border border-[#2a3f5f] bg-[#0f1729] p-3 text-sm">
                <span className="text-xs text-slate-500">Subject</span>
                <p className="font-medium text-[#185FA5]">{emailSubject}</p>
              </div>
            ) : null}
            {tab === "social" ? (
              <p className="text-xs text-slate-500">{socialChars} characters</p>
            ) : null}
            <div className="max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded border border-[#2a3f5f] bg-[#0f1729] p-4 text-sm text-slate-200">
              {preview || "Generated content appears here."}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[#2a3f5f] px-4 py-2 text-sm"
                onClick={() => {
                  if (preview) void navigator.clipboard.writeText(preview);
                }}
              >
                Copy
              </button>
              {tab === "blog" ? (
                <button
                  type="button"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: "#166534" }}
                  onClick={() => void saveBlog()}
                >
                  Save
                </button>
              ) : null}
            </div>
            {savedMsg ? (
              <p className="text-sm text-emerald-300">{savedMsg}</p>
            ) : null}
          </section>
        </div>

        <section className="rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
          <h2 className="text-lg font-semibold text-white">Brand voice</h2>
          <p className="mt-1 text-sm text-slate-400">
            Saved context is injected into every generation request.
          </p>
          <textarea
            className="mt-4 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-3 text-sm text-white"
            rows={5}
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            placeholder="Describe how Katz Melinger should sound in marketing…"
          />
          <button
            type="button"
            disabled={brandLoading}
            onClick={() => void saveBrandVoice()}
            className="mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: ACCENT }}
          >
            {brandLoading ? "Saving…" : "Save brand voice"}
          </button>
        </section>
      </main>
    </div>
  );
}
