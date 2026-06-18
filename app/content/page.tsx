"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { marked } from "marked";

import { MarketingNav } from "@/components/marketing-nav";
import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import { readContentType } from "@/lib/content-types";

const CARD = "#ffffff";
const BORDER = "#e2e8f0";
const ACCENT = "#185FA5";

const DEFAULT_BRAND_VOICE =
  "Describe your firm's brand voice here: who you serve, your practice areas, your tone (e.g. professional but approachable), how you explain complex legal ideas to clients, and what sets you apart. The AI reads this before drafting anything.";

const PRACTICE_AREAS = [
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
  "General",
] as const;

const TEMPLATE_OPTIONS = {
  blog: [
    { id: "blog_general", label: "General legal explainer" },
    { id: "case_study", label: "Case study" },
    { id: "newsletter", label: "Newsletter article" },
  ],
  social: [{ id: "social_post", label: "Social post" }],
  email: [
    { id: "newsletter", label: "Newsletter" },
    { id: "case_study", label: "Case update" },
  ],
} as const;

type BrandVoiceProfile = {
  tone: string[];
  stylePreferences: string[];
  legalTerms: string[];
  commonPhrases: string[];
  disclaimers: string[];
  messagingPatterns: string[];
  guidelinesSummary: string;
  sourceDocumentCount: number;
  updatedAt: string;
};

type BrandVoiceDoc = {
  id: string;
  filename: string;
  document_type: "brand" | "sample";
  text_excerpt: string;
  text_length: number;
  uploaded_at: string;
};

type BrandVoiceResponse = {
  context?: string;
  profile?: BrandVoiceProfile | null;
  documents?: BrandVoiceDoc[];
};

type SeoBrief = {
  targetKeywords: string[];
  longTailKeywords: string[];
  titleIdeas: string[];
  headings: string[];
  competitorGaps: string[];
};

export default function ContentPage() {
  const searchParams = useSearchParams();
  const contentType = readContentType(searchParams);
  // Internal `tab` value used by the existing form logic — derived from the
  // top-level type tab. "website" → blog form, "social" / "email" map 1:1.
  const tab: "blog" | "social" | "email" =
    contentType === "website" ? "blog" : contentType;
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
  const [templateKey, setTemplateKey] = useState<string>("blog_general");
  const [useBrandVoice, setUseBrandVoice] = useState(true);

  const [profile, setProfile] = useState<BrandVoiceProfile | null>(null);
  const [documents, setDocuments] = useState<BrandVoiceDoc[]>([]);
  const [docMessage, setDocMessage] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [brandFiles, setBrandFiles] = useState<FileList | null>(null);
  const [sampleFiles, setSampleFiles] = useState<FileList | null>(null);
  const [uploadingType, setUploadingType] = useState<"brand" | "sample" | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [seoBrief, setSeoBrief] = useState<SeoBrief | null>(null);
  const [seoBriefLoading, setSeoBriefLoading] = useState(false);
  const [seoBriefError, setSeoBriefError] = useState<string | null>(null);
  const [includeSeoGuidance, setIncludeSeoGuidance] = useState(true);

  const loadBrand = useCallback(async () => {
    const res = await fetch("/api/content/brand-voice", { cache: "no-store" });
    const j = (await res.json()) as BrandVoiceResponse;
    const ctx = typeof j.context === "string" ? j.context.trim() : "";
    setBrandVoice(ctx || DEFAULT_BRAND_VOICE);
    setProfile(j.profile ?? null);
    setDocuments(Array.isArray(j.documents) ? j.documents : []);
  }, []);

  useEffect(() => {
    void loadBrand();
  }, [loadBrand]);

  useEffect(() => {
    setTemplateKey(tab === "blog" ? "blog_general" : tab === "social" ? "social_post" : "newsletter");
  }, [tab]);

  const loadSeoBrief = useCallback(
    async (topicInput: string, practiceAreaInput: string) => {
      const normalized = topicInput.trim();
      if (!normalized) {
        setSeoBrief(null);
        setSeoBriefError(null);
        return;
      }
      setSeoBriefLoading(true);
      setSeoBriefError(null);
      try {
        const query = new URLSearchParams({
          topic: normalized,
          practice_area: practiceAreaInput,
        });
        const res = await fetch(`/api/seo/content/brief?${query.toString()}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as SeoBrief & { error?: string };
        if (!res.ok) {
          setSeoBrief(null);
          setSeoBriefError(body.error ?? "Could not fetch SEO brief.");
          return;
        }
        setSeoBrief({
          targetKeywords: Array.isArray(body.targetKeywords) ? body.targetKeywords : [],
          longTailKeywords: Array.isArray(body.longTailKeywords) ? body.longTailKeywords : [],
          titleIdeas: Array.isArray(body.titleIdeas) ? body.titleIdeas : [],
          headings: Array.isArray(body.headings) ? body.headings : [],
          competitorGaps: Array.isArray(body.competitorGaps) ? body.competitorGaps : [],
        });
      } catch (e) {
        setSeoBrief(null);
        setSeoBriefError(e instanceof Error ? e.message : "Could not fetch SEO brief.");
      } finally {
        setSeoBriefLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const normalized = topic.trim();
    if (!normalized) {
      setSeoBrief(null);
      setSeoBriefError(null);
      return;
    }
    const timer = setTimeout(() => {
      void loadSeoBrief(normalized, practiceArea);
    }, 450);
    return () => clearTimeout(timer);
  }, [topic, practiceArea, loadSeoBrief]);

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
        template_key: templateKey,
        use_brand_voice: useBrandVoice,
      };
      if (includeSeoGuidance && seoBrief) {
        body.seo_brief = seoBrief;
        body.target_keywords = seoBrief.targetKeywords;
      }
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

  async function uploadDocs(type: "brand" | "sample") {
    const files = type === "brand" ? brandFiles : sampleFiles;
    if (!files || files.length === 0) {
      setDocError(`Choose at least one PDF for ${type} upload.`);
      return;
    }
    setUploadingType(type);
    setUploadProgress("Uploading files...");
    setDocError(null);
    setDocMessage(null);
    try {
      const form = new FormData();
      form.set("documentType", type);
      for (const file of Array.from(files)) {
        form.append("files", file);
      }
      setUploadProgress("Extracting and analyzing PDF text...");
      const res = await fetch("/api/content/brand-documents", {
        method: "POST",
        body: form,
      });
      const j = (await res.json()) as {
        ok?: boolean;
        message?: string;
        failures?: Array<{ filename: string; error: string }>;
        profile?: BrandVoiceProfile | null;
      };
      if (!res.ok || !j.ok) {
        const failureText =
          Array.isArray(j.failures) && j.failures.length
            ? ` ${j.failures.map((f) => `${f.filename}: ${f.error}`).join(" | ")}`
            : "";
        setDocError((j.message || "Upload failed.") + failureText);
        return;
      }
      setDocMessage(j.message ?? "Documents uploaded.");
      setProfile(j.profile ?? null);
      await loadBrand();
      if (type === "brand") setBrandFiles(null);
      else setSampleFiles(null);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingType(null);
      setUploadProgress("");
    }
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
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Content studio</h1>
          <p className="mt-1 text-sm text-slate-500">AI drafts · your brand voice</p>
        </div>

        <ContentTypeTabs />
        <ContentNav />

        {/* Brief + preview sit side-by-side until generation begins, then the
            preview takes the full width so the draft is comfortable to read. */}
        <div className={`grid gap-8 ${loading || preview ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
          <section className="space-y-4 rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
            {tab === "social" ? (
              <label className="block text-sm">
                <span className="text-xs text-slate-500">Platform</span>
                <select
                  className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
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
                <span className="text-xs text-slate-500">Campaign type</span>
                <select
                  className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
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
              <span className="text-xs text-slate-500">Topic</span>
              <input
                className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What should this piece cover?"
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-500">Template</span>
              <select
                className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
              >
                {(tab === "blog"
                  ? TEMPLATE_OPTIONS.blog
                  : tab === "social"
                    ? TEMPLATE_OPTIONS.social
                    : TEMPLATE_OPTIONS.email
                ).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-500">Practice area</span>
              <select
                className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
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

            <div className="rounded border border-[#e2e8f0] bg-[#ffffff] p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">SEO keyword assistant (Semrush + competitor gaps)</p>
                <button
                  type="button"
                  onClick={() => void loadSeoBrief(topic, practiceArea)}
                  className="rounded border border-[#e2e8f0] px-2 py-1 text-xs text-slate-700"
                >
                  Refresh
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeSeoGuidance}
                  onChange={(e) => setIncludeSeoGuidance(e.target.checked)}
                />
                Include SEO brief in generation
              </label>
              {seoBriefLoading ? <p className="mt-2 text-xs text-slate-500">Loading SEO brief...</p> : null}
              {seoBriefError ? <p className="mt-2 text-xs text-rose-300">{seoBriefError}</p> : null}
              {seoBrief ? (
                <div className="mt-2 space-y-2 text-xs text-slate-600">
                  <p>
                    <span className="text-slate-500">Target keywords:</span>{" "}
                    {seoBrief.targetKeywords.join(", ") || "—"}
                  </p>
                  <p>
                    <span className="text-slate-500">Long-tail ideas:</span>{" "}
                    {seoBrief.longTailKeywords.slice(0, 3).join(" | ") || "—"}
                  </p>
                </div>
              ) : null}
            </div>

            {tab === "blog" ? (
              <>
                <label className="block text-sm">
                  <span className="text-xs text-slate-500">Length</span>
                  <select
                    className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
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
                  <span className="text-xs text-slate-500">Tone</span>
                  <select
                    className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
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
                <span className="text-xs text-slate-500">Tone</span>
                <select
                  className="mt-1 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-slate-900"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option>Professional</option>
                  <option>Conversational</option>
                  <option>Urgent</option>
                </select>
              </label>
            )}

            <label className="flex cursor-pointer items-center gap-2 rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={useBrandVoice}
                onChange={(e) => setUseBrandVoice(e.target.checked)}
                className="h-4 w-4 rounded border-[#e2e8f0] bg-[#ffffff] text-brand"
              />
              Generate with brand voice
            </label>

            {err ? <p className="text-sm text-rose-300">{err}</p> : null}

            <button
              type="button"
              disabled={loading || !topic.trim()}
              onClick={() => void generate()}
              className="w-full rounded-lg py-3 text-sm font-semibold text-slate-900 disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? "Generating…" : "Generate"}
            </button>
          </section>

          <PreviewPane
            preview={preview}
            tab={tab}
            emailSubject={emailSubject}
            socialChars={socialChars}
          />
          {savedMsg ? (
            <p className="text-sm text-emerald-300 lg:col-span-2">{savedMsg}</p>
          ) : null}
        </div>

        <section className="rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
          <h2 className="text-lg font-semibold text-slate-900">Brand voice</h2>
          <p className="mt-1 text-sm text-slate-500">
            Saved context is injected into every generation request.
          </p>
          <textarea
            className="mt-4 w-full rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-3 text-sm text-slate-900"
            rows={5}
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            placeholder="Describe how your firm should sound in marketing…"
          />
          <button
            type="button"
            disabled={brandLoading}
            onClick={() => void saveBrandVoice()}
            className="mt-3 rounded-lg px-4 py-2 text-sm font-medium text-slate-900"
            style={{ backgroundColor: ACCENT }}
          >
            {brandLoading ? "Saving…" : "Save brand voice"}
          </button>
          {profile ? (
            <div className="mt-4 rounded border border-[#e2e8f0] bg-[#ffffff] p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Guidelines summary</p>
              <p className="mt-2 text-slate-600">{profile.guidelinesSummary}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tone</p>
                  <p className="mt-1 text-slate-600">{profile.tone.join(", ") || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Legal terms</p>
                  <p className="mt-1 text-slate-600">{profile.legalTerms.join(", ") || "—"}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
          <h2 className="text-lg font-semibold text-slate-900">Upload brand documents</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload PDF assets used to train writing style and legal messaging.
          </p>
          {docError ? <p className="mt-3 text-sm text-rose-300">{docError}</p> : null}
          {docMessage ? <p className="mt-3 text-sm text-emerald-300">{docMessage}</p> : null}
          {uploadProgress ? <p className="mt-2 text-xs text-slate-500">{uploadProgress}</p> : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-[#e2e8f0] bg-[#ffffff] p-4">
              <p className="font-medium text-slate-900">Firm brand documents</p>
              <p className="mt-1 text-xs text-slate-500">
                Upload brand voice guides, website copy decks, and legal content
                standards. Accepts .pdf, .docx, .txt, .md, .rtf, .html.
              </p>
              <input
                className="mt-3 block w-full text-sm text-slate-600"
                type="file"
                accept=".pdf,.docx,.txt,.md,.rtf,.html,.htm"
                multiple
                onChange={(e) => setBrandFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploadingType !== null}
                onClick={() => void uploadDocs("brand")}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {uploadingType === "brand" ? "Processing..." : "Train brand voice from documents"}
              </button>
            </div>
            <div className="rounded border border-[#e2e8f0] bg-[#ffffff] p-4">
              <p className="font-medium text-slate-900">Sample marketing content</p>
              <p className="mt-1 text-xs text-slate-500">
                Upload past newsletters, social exports, and campaign writeups
                for pattern analysis. Accepts .pdf, .docx, .txt, .md, .rtf, .html.
              </p>
              <input
                className="mt-3 block w-full text-sm text-slate-600"
                type="file"
                accept=".pdf,.docx,.txt,.md,.rtf,.html,.htm"
                multiple
                onChange={(e) => setSampleFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploadingType !== null}
                onClick={() => void uploadDocs("sample")}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
                style={{ backgroundColor: "#1d9e75" }}
              >
                {uploadingType === "sample" ? "Processing..." : "Analyze sample marketing documents"}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-medium text-slate-900">Uploaded documents</p>
            <ul className="mt-2 space-y-2">
              {documents.slice(0, 10).map((doc) => (
                <li
                  key={doc.id}
                  className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-xs text-slate-600"
                >
                  <span className="font-medium text-slate-700">{doc.filename}</span>
                  <span className="ml-2 text-slate-500">
                    ({doc.document_type}, {doc.text_length.toLocaleString()} chars)
                  </span>
                </li>
              ))}
              {!documents.length ? (
                <li className="text-xs text-slate-500">No uploaded documents yet.</li>
              ) : null}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Generated content preview pane.
 *
 * Renders markdown as HTML so headings / bold / bullets show formatted —
 * not as `##`, `**`, `-`. The Copy button puts both rich-text (text/html)
 * and plain-text on the clipboard so pasting into Word or Google Docs
 * preserves formatting; pasting into a plain editor gets the markdown.
 *
 * The browser Clipboard API requires user activation (a click). Falls back
 * to plain-text copy if the rich-text path fails.
 */
function PreviewPane({
  preview,
  tab,
  emailSubject,
  socialChars,
}: {
  preview: string;
  tab: "blog" | "social" | "email";
  emailSubject: string;
  socialChars: number;
}) {
  const renderedHtml = useMemo(() => {
    if (!preview.trim()) return "";
    // marked.parse can be sync or async depending on configured extensions;
    // we use no async ones, so the result is a string here.
    return marked.parse(preview, { async: false }) as string;
  }, [preview]);

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copyFormatted = async () => {
    if (!preview.trim()) return;
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.ClipboardItem !== "undefined" &&
        navigator.clipboard &&
        "write" in navigator.clipboard
      ) {
        const html = renderedHtml || preview;
        const item = new window.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([preview], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(preview);
      }
      setCopyStatus("copied");
    } catch {
      try {
        await navigator.clipboard.writeText(preview);
        setCopyStatus("copied");
      } catch {
        setCopyStatus("failed");
      }
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  const copyMarkdown = async () => {
    if (!preview.trim()) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  return (
    <section
      className="space-y-3 rounded-xl border p-6"
      style={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }}
    >
      <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
      {tab === "email" && emailSubject ? (
        <div className="rounded border border-[#e2e8f0] bg-[#ffffff] p-3 text-sm">
          <span className="text-xs text-slate-500">Subject</span>
          <p className="font-medium text-brand">{emailSubject}</p>
        </div>
      ) : null}
      {tab === "social" ? (
        <p className="text-xs text-slate-500">{socialChars} characters</p>
      ) : null}
      {preview ? (
        <div
          className="max-h-[70vh] overflow-y-auto rounded border border-[#e2e8f0] bg-[#ffffff] p-4 text-sm text-slate-800 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2 [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <div className="rounded border border-dashed border-[#e2e8f0] bg-[#ffffff] p-4 text-sm text-slate-400">
          Generated content appears here.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!preview.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          onClick={() => void copyFormatted()}
        >
          Copy (Word-ready)
        </button>
        <button
          type="button"
          disabled={!preview.trim()}
          className="rounded-lg border border-[#e2e8f0] px-4 py-2 text-sm text-slate-700 hover:border-slate-300 disabled:opacity-50"
          onClick={() => void copyMarkdown()}
          title="Copy raw markdown (use when pasting into a plain-text editor)"
        >
          Copy markdown
        </button>
        {copyStatus === "copied" && (
          <span className="text-xs text-emerald-700">Copied!</span>
        )}
        {copyStatus === "failed" && (
          <span className="text-xs text-red-700">Copy failed — your browser blocked clipboard access.</span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          Drafts autosave to the library below.
        </span>
      </div>
    </section>
  );
}
