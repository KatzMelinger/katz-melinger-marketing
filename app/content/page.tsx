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
              <span className="text-xs text-slate-400">Template</span>
              <select
                className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
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

            <label className="flex cursor-pointer items-center gap-2 rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={useBrandVoice}
                onChange={(e) => setUseBrandVoice(e.target.checked)}
                className="h-4 w-4 rounded border-[#2a3f5f] bg-[#0f1729] text-[#185FA5]"
              />
              Generate with brand voice
            </label>

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
          {profile ? (
            <div className="mt-4 rounded border border-[#2a3f5f] bg-[#0f1729] p-4 text-sm text-slate-200">
              <p className="font-semibold text-white">Guidelines summary</p>
              <p className="mt-2 text-slate-300">{profile.guidelinesSummary}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Tone</p>
                  <p className="mt-1 text-slate-300">{profile.tone.join(", ") || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Legal terms</p>
                  <p className="mt-1 text-slate-300">{profile.legalTerms.join(", ") || "—"}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border p-6" style={{ backgroundColor: CARD, borderColor: BORDER }}>
          <h2 className="text-lg font-semibold text-white">Upload brand documents</h2>
          <p className="mt-1 text-sm text-slate-400">
            Upload PDF assets used to train writing style and legal messaging.
          </p>
          {docError ? <p className="mt-3 text-sm text-rose-300">{docError}</p> : null}
          {docMessage ? <p className="mt-3 text-sm text-emerald-300">{docMessage}</p> : null}
          {uploadProgress ? <p className="mt-2 text-xs text-slate-400">{uploadProgress}</p> : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-[#2a3f5f] bg-[#0f1729] p-4">
              <p className="font-medium text-white">Firm brand documents (PDF)</p>
              <p className="mt-1 text-xs text-slate-500">
                Upload brand voice guides, website copy decks, and legal content standards.
              </p>
              <input
                className="mt-3 block w-full text-sm text-slate-300"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(e) => setBrandFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploadingType !== null}
                onClick={() => void uploadDocs("brand")}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {uploadingType === "brand" ? "Processing..." : "Train brand voice from PDFs"}
              </button>
            </div>
            <div className="rounded border border-[#2a3f5f] bg-[#0f1729] p-4">
              <p className="font-medium text-white">Sample marketing content (PDF)</p>
              <p className="mt-1 text-xs text-slate-500">
                Upload past newsletters, social exports, and campaign writeups for pattern analysis.
              </p>
              <input
                className="mt-3 block w-full text-sm text-slate-300"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(e) => setSampleFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploadingType !== null}
                onClick={() => void uploadDocs("sample")}
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "#1d9e75" }}
              >
                {uploadingType === "sample" ? "Processing..." : "Analyze sample marketing PDFs"}
              </button>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-medium text-white">Uploaded documents</p>
            <ul className="mt-2 space-y-2">
              {documents.slice(0, 10).map((doc) => (
                <li
                  key={doc.id}
                  className="rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-xs text-slate-300"
                >
                  <span className="font-medium text-slate-200">{doc.filename}</span>
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
