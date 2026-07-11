"use client";

/**
 * Firm onboarding wizard.
 *
 * Where a newly signed-up firm configures its white-label profile: identity,
 * SEO domains, practice areas + brand voice, and an AI-generated content system
 * prompt. Steps 1-3 persist via POST /api/onboarding (tenant_settings +
 * brand_voice_settings + practice_areas); step 4 reuses /api/brand-voice/
 * system-prompt (generate + save). Standalone (no sidebar — see NO_CHROME_PATHS).
 */

import { useEffect, useState } from "react";

const STEPS = ["Firm identity", "Search & domains", "Practice & voice", "Content prompt"];

function hostFromUrl(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/:].*$/, "");
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  help?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      {help && <p className="text-[11px] text-slate-500 mt-1">{help}</p>}
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  placeholder,
  rows = 6,
  help,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  help?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand ${mono ? "font-mono text-xs" : ""}`}
      />
      {help && <p className="text-[11px] text-slate-500 mt-1">{help}</p>}
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Identity
  const [firmName, setFirmName] = useState("");
  const [firmWebsite, setFirmWebsite] = useState("");
  const [firmEmail, setFirmEmail] = useState("");
  const [firmPhone, setFirmPhone] = useState("");
  const [firmAddress, setFirmAddress] = useState("");
  const [targetGeography, setTargetGeography] = useState("");
  const [firmSpokesperson, setFirmSpokesperson] = useState("");
  // Branding
  const [brandColor, setBrandColor] = useState("#116AB2");
  const [logoUrl, setLogoUrl] = useState("");
  // Domains
  const [seoDomain, setSeoDomain] = useState("");
  const [gscSiteUrl, setGscSiteUrl] = useState("");
  // Practice + voice
  const [practiceAreasText, setPracticeAreasText] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  // System prompt
  const [systemPrompt, setSystemPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  // Prefill identity/voice from existing settings (firm name comes from signup).
  // We do NOT prefill practice areas — a new firm starts blank, not on defaults.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brand-voice/settings");
        if (!res.ok) return;
        const { settings = {} } = await res.json();
        setFirmName(settings.firmName ?? "");
        setFirmWebsite(settings.firmWebsite ?? "");
        setFirmEmail(settings.firmEmail ?? "");
        setFirmPhone(settings.firmPhone ?? "");
        setFirmAddress(settings.firmAddress ?? "");
        setTargetGeography(settings.targetGeography ?? "");
        setFirmSpokesperson(settings.firmSpokesperson ?? "");
        setBrandVoice(settings.brandVoice ?? "");
        setToneOfVoice(settings.toneOfVoice ?? "");
      } catch {
        /* ignore — fields stay blank */
      }
    })();
  }, []);

  const practiceAreas = practiceAreasText
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // When entering the Domains step, prefill from the website if still blank.
  const goToDomains = () => {
    const host = hostFromUrl(firmWebsite);
    if (host) {
      if (!seoDomain) setSeoDomain(host);
      if (!gscSiteUrl) setGscSiteUrl(`https://${host}/`);
    }
    setStep(1);
  };

  const saveProfile = async (): Promise<boolean> => {
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmName,
          firmWebsite,
          firmEmail,
          firmPhone,
          firmAddress,
          targetGeography,
          firmSpokesperson,
          brandColor,
          logoUrl,
          seoDomain,
          gscSiteUrl,
          practiceAreas,
          brandVoice,
          toneOfVoice,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      return false;
    } finally {
      setSavingProfile(false);
    }
  };

  const continueToPrompt = async () => {
    if (await saveProfile()) setStep(3);
  };

  const generatePrompt = async () => {
    setGenerating(true);
    setError(null);
    setPromptSaved(false);
    try {
      const res = await fetch("/api/brand-voice/system-prompt", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      setSystemPrompt(data.systemPrompt ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-voice/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setPromptSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingPrompt(false);
    }
  };

  const finish = () => {
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-brand">Set up your firm</h1>
          <p className="text-sm text-slate-600 mt-1">
            A few details so the dashboard and AI content are branded to your firm. You can change
            any of this later under Content Standards.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  i === step
                    ? "bg-brand text-white"
                    : i < step
                      ? "bg-brand/20 text-brand"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "font-medium text-slate-900" : "text-slate-500"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          {error && <p className="text-sm text-red-700">{error}</p>}

          {step === 0 && (
            <div className="space-y-3">
              <Field label="Firm name" value={firmName} onChange={setFirmName} placeholder="Your Firm LLP" />
              <Field label="Website" value={firmWebsite} onChange={setFirmWebsite} placeholder="https://www.yourfirm.com" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email" value={firmEmail} onChange={setFirmEmail} placeholder="info@yourfirm.com" />
                <Field label="Phone" value={firmPhone} onChange={setFirmPhone} placeholder="(555) 123-4567" />
              </div>
              <Field label="Office address" value={firmAddress} onChange={setFirmAddress} placeholder="123 Main Street, Suite 100, City, ST 00000" />
              <Field label="Target geography" value={targetGeography} onChange={setTargetGeography} placeholder="City, state, or region you serve" />
              <Field
                label="PR spokesperson (name + title)"
                value={firmSpokesperson}
                onChange={setFirmSpokesperson}
                placeholder="Jane Doe, Partner at Your Firm LLP"
                help="Used as the attorney attribution in PR pitches and quotes."
              />
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-xs font-medium text-slate-700">Brand color</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#116AB2"}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="h-9 w-12 rounded border border-slate-300 p-0.5"
                      aria-label="Brand color"
                    />
                    <input
                      type="text"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      placeholder="#116AB2"
                      className="flex-1 px-3 py-2 rounded-md border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Used as the accent color across the dashboard.</p>
                </div>
                <Field
                  label="Logo URL (optional)"
                  value={logoUrl}
                  onChange={setLogoUrl}
                  placeholder="https://www.yourfirm.com/logo.png"
                  help="Shown in the sidebar instead of the firm name."
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Your SEO and Search Console data are pulled for these. We prefilled them from your
                website — adjust if needed.
              </p>
              <Field
                label="SEO domain"
                value={seoDomain}
                onChange={setSeoDomain}
                placeholder="yourfirm.com"
                help="Bare domain (no https://). Used for keyword, backlink, and competitor data."
              />
              <Field
                label="Search Console site URL"
                value={gscSiteUrl}
                onChange={setGscSiteUrl}
                placeholder="https://yourfirm.com/"
                help="The exact property URL as verified in Google Search Console."
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Area
                label="Practice areas"
                value={practiceAreasText}
                onChange={setPracticeAreasText}
                placeholder={"One per line, e.g.\nImmigration\nEmployment\nPersonal Injury"}
                rows={6}
                help="One per line (or comma-separated). These drive content topics and PR fit."
              />
              <Area
                label="Brand voice"
                value={brandVoice}
                onChange={setBrandVoice}
                placeholder="Who you serve, your tone (e.g. professional but approachable), how you explain legal ideas, and what sets you apart."
                rows={6}
                help="The AI reads this before drafting any content."
              />
              <Field label="Tone of voice" value={toneOfVoice} onChange={setToneOfVoice} placeholder="e.g. Professional, plain-spoken, empathetic" />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Generate a content system prompt from everything above — the master instructions the
                AI follows when writing for your firm. Review and edit it, then save.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={generatePrompt}
                  disabled={generating}
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                >
                  {generating ? "Generating…" : "✨ Generate from firm profile"}
                </button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={savingPrompt || !systemPrompt.trim()}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400 disabled:opacity-50"
                >
                  {savingPrompt ? "Saving…" : "Save prompt"}
                </button>
                {promptSaved && <span className="self-center text-sm text-emerald-700">Saved ✓</span>}
              </div>
              <Area
                label=""
                value={systemPrompt}
                onChange={(v) => {
                  setSystemPrompt(v);
                  setPromptSaved(false);
                }}
                placeholder="Click Generate to draft a firm-specific prompt, or leave blank to use the built-in default."
                rows={18}
                mono
              />
              <p className="text-[11px] text-slate-500">
                Optional — you can skip this and the built-in default is used until you customize it.
              </p>
            </div>
          )}

          {/* Nav */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="text-sm text-slate-500 hover:text-slate-900"
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <a href="/" className="text-xs text-slate-400 hover:text-slate-600">
                Skip for now
              </a>
              {step === 0 && (
                <button
                  type="button"
                  onClick={goToDomains}
                  disabled={!firmName.trim()}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                >
                  Next
                </button>
              )}
              {step === 1 && (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
                >
                  Next
                </button>
              )}
              {step === 2 && (
                <button
                  type="button"
                  onClick={continueToPrompt}
                  disabled={savingProfile}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                >
                  {savingProfile ? "Saving…" : "Save & continue"}
                </button>
              )}
              {step === 3 && (
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
                >
                  Finish →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
