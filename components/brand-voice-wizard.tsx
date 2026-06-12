"use client";

/**
 * Three independent brand-asset wizards — one each for the brand-voice guide,
 * the audience avatars, and the content directions. They are NOT chained: each
 * is launched on its own from its section on /brand-voice, drafts only its own
 * slice via POST /api/brand-voice/wizard/generate (with a `target`), lets the
 * user edit, and saves through the existing endpoint for that asset.
 *
 *   BrandVoiceWizard → PUT  /api/brand-voice/settings
 *   AvatarsWizard    → POST /api/brand-voice/avatars   (one per avatar)
 *   DirectionsWizard → POST /api/content/skills        (one per direction)
 *
 * Each is a two-step flow: 1. Describe → (AI draft) → 2. Review & save.
 * Modeled on components/km-brief-wizard.tsx.
 */

import { useEffect, useState } from "react";

// ---------- shared brand profile (prefill) --------------------------------
// All three wizards read the firm's saved brand settings once on open and
// prefill their intake from them, so you don't retype the business basics in
// each wizard. The business description / audience / tone you enter in one
// wizard are persisted back (as settings keys) so the next wizard you open is
// already seeded. These extra keys are inert for the AI — they're only used
// for prefill — and the dashboard's settings form ignores them.

type BrandProfile = {
  firmName: string;
  targetGeography: string;
  description: string;
  services: string;
  audienceNotes: string;
  tonePreferences: string;
};

const EMPTY_PROFILE: BrandProfile = {
  firmName: "",
  targetGeography: "",
  description: "",
  services: "",
  audienceNotes: "",
  tonePreferences: "",
};

/** Fetches saved brand settings once. Returns null while loading, then a
 *  (possibly empty) profile. Never throws — prefill is best-effort. */
function useBrandProfile(): BrandProfile | null {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/brand-voice/settings")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const s = (d?.settings ?? {}) as Record<string, string>;
        setProfile({
          firmName: s.firmName || "",
          targetGeography: s.targetGeography || "",
          description: s.businessDescription || "",
          services: s.businessServices || "",
          audienceNotes: s.businessAudience || "",
          tonePreferences: s.tonePreferences || s.toneOfVoice || "",
        });
      })
      .catch(() => live && setProfile(EMPTY_PROFILE));
    return () => {
      live = false;
    };
  }, []);
  return profile;
}

/** Best-effort upsert of the reusable business-profile fields so other wizards
 *  prefill from them. Silent on failure — it's a convenience, not core. */
async function persistProfile(fields: Record<string, string>): Promise<void> {
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v && v.trim()) settings[k] = v;
  if (Object.keys(settings).length === 0) return;
  await fetch("/api/brand-voice/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  }).catch(() => {});
}

// ---------- shared modal shell --------------------------------------------

function WizardShell({
  title,
  subtitle,
  steps,
  step,
  onStepClick,
  onClose,
  onPrev,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryTone = "brand",
  hideFooter = false,
  children,
}: {
  title: string;
  subtitle: string;
  steps: string[];
  step: number;
  onStepClick?: (i: number) => void;
  onClose: () => void;
  onPrev: (() => void) | null;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryTone?: "brand" | "emerald";
  hideFooter?: boolean;
  children: React.ReactNode;
}) {
  const primaryClass =
    primaryTone === "emerald"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : "bg-[#185FA5] hover:bg-[#1f6fb8]";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">{subtitle}</p>
              <h3 className="mt-0.5 text-lg font-semibold text-slate-900">{title}</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {!hideFooter && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {steps.map((label, i) => (
                <button
                  key={label}
                  onClick={() => onStepClick && i <= step && onStepClick(i)}
                  disabled={i > step}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed ${
                    i === step
                      ? "bg-[#185FA5] text-white"
                      : i < step
                        ? "bg-[#185FA5]/10 text-[#185FA5]"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {i + 1}. {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {!hideFooter && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
            <button
              onClick={() => onPrev && onPrev()}
              disabled={!onPrev}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={onPrimary}
              disabled={primaryDisabled}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${primaryClass}`}
            >
              {primaryLabel}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.bvw-inp) {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          padding: 0.45rem 0.6rem;
          font-size: 0.875rem;
          color: #0f172a;
          background: #fff;
        }
        :global(.bvw-inp:focus) {
          outline: none;
          border-color: #185fa5;
        }
      `}</style>
    </div>
  );
}

function BvField({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function DoneScreen({
  heading,
  detail,
  warnings,
  onClose,
}: {
  heading: string;
  detail: string;
  warnings: string[];
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-6 text-center">
      <div className="text-3xl">✓</div>
      <h4 className="text-lg font-semibold text-slate-900">{heading}</h4>
      <p className="text-sm text-slate-600">{detail}</p>
      {warnings.length > 0 && (
        <div className="mx-auto max-w-md rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-left">
          <p className="text-[11px] font-medium text-amber-700">Some items didn&apos;t save:</p>
          <ul className="mt-1 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[11px] text-amber-800">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-center gap-2 pt-2">
        <button
          onClick={onClose}
          className="rounded-md bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8]"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function GeneratingBanner({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-[#185FA5]/30 bg-[#185FA5]/5 px-3 py-2 text-sm text-[#185FA5]">
      Drafting {what} with AI… this takes ~15–30s.
    </div>
  );
}

// A small hook bundling the generate→review→save lifecycle shared by all three.
function useWizardLifecycle() {
  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  return {
    step,
    setStep,
    generating,
    setGenerating,
    genError,
    setGenError,
    saving,
    setSaving,
    saveError,
    setSaveError,
  };
}

const STEPS = ["Describe", "Review & save"];

// ===========================================================================
// 1. Brand Voice wizard
// ===========================================================================

type Settings = {
  firmName: string;
  targetGeography: string;
  brandVoice: string;
  keyMessages: string;
  toneOfVoice: string;
};

export function BrandVoiceWizard({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const lc = useWizardLifecycle();
  const [intake, setIntake] = useState({
    firmName: "",
    targetGeography: "",
    description: "",
    services: "",
    tonePreferences: "",
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [done, setDone] = useState(false);

  const profile = useBrandProfile();
  useEffect(() => {
    if (!profile) return;
    // Merge prefill under anything already typed (prefill arrives before the
    // user starts, so in practice it fills the blanks).
    setIntake((s) => ({
      firmName: s.firmName || profile.firmName,
      targetGeography: s.targetGeography || profile.targetGeography,
      description: s.description || profile.description,
      services: s.services || profile.services,
      tonePreferences: s.tonePreferences || profile.tonePreferences,
    }));
  }, [profile]);

  const setIn = (p: Partial<typeof intake>) => setIntake((s) => ({ ...s, ...p }));
  const setS = (p: Partial<Settings>) =>
    setSettings((s) => (s ? { ...s, ...p } : s));

  const generate = async () => {
    if (!intake.description.trim()) {
      lc.setGenError("Tell us what the business does and who it serves first.");
      return;
    }
    lc.setGenError(null);
    lc.setGenerating(true);
    try {
      const res = await fetch("/api/brand-voice/wizard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "brandVoice", ...intake }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setSettings({
        firmName: data?.settings?.firmName ?? intake.firmName,
        targetGeography: data?.settings?.targetGeography ?? intake.targetGeography,
        brandVoice: data?.settings?.brandVoice ?? "",
        keyMessages: data?.settings?.keyMessages ?? "",
        toneOfVoice: data?.settings?.toneOfVoice ?? "",
      });
      lc.setStep(1);
    } catch (e) {
      lc.setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      lc.setGenerating(false);
    }
  };

  const save = async () => {
    if (!settings) return;
    lc.setSaving(true);
    lc.setSaveError(null);
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings)) if (v && v.trim()) payload[k] = v;
    // Persist the reusable business profile so the avatar/direction wizards
    // prefill from it (inert keys — ignored by the AI and the settings form).
    if (intake.description.trim()) payload.businessDescription = intake.description.trim();
    if (intake.services.trim()) payload.businessServices = intake.services.trim();
    if (intake.tonePreferences.trim()) payload.tonePreferences = intake.tonePreferences.trim();
    try {
      if (Object.keys(payload).length > 0) {
        const res = await fetch("/api/brand-voice/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: payload }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error || "Failed to save brand settings");
        }
      }
      setDone(true);
      onSaved();
    } catch (e) {
      lc.setSaveError(e instanceof Error ? e.message : "Failed to save brand settings");
    } finally {
      lc.setSaving(false);
    }
  };

  return (
    <WizardShell
      title="Brand voice guide"
      subtitle="Brand voice setup"
      steps={STEPS}
      step={lc.step}
      onStepClick={(i) => settings && lc.setStep(i)}
      onClose={onClose}
      hideFooter={done}
      onPrev={lc.step > 0 ? () => lc.setStep(0) : null}
      primaryLabel={
        lc.step === 0
          ? lc.generating
            ? "Drafting with AI…"
            : "Generate draft →"
          : lc.saving
            ? "Saving…"
            : "Save brand voice"
      }
      primaryTone={lc.step === 0 ? "brand" : "emerald"}
      primaryDisabled={
        lc.step === 0
          ? lc.generating || !intake.description.trim()
          : lc.saving
      }
      onPrimary={lc.step === 0 ? generate : save}
    >
      {done ? (
        <DoneScreen
          heading="Brand voice saved"
          detail="Your voice guide, key messages, and tone are saved. Every AI feature in MarketOS will use them from now on."
          warnings={[]}
          onClose={onClose}
        />
      ) : lc.step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Describe the business and Claude drafts a brand-voice guide, key
            messages, and tone — then you review and edit before it saves.
          </p>
          {lc.generating && <GeneratingBanner what="your brand voice" />}
          <div className="grid grid-cols-2 gap-4">
            <BvField label="Business / firm name">
              <input
                className="bvw-inp"
                value={intake.firmName}
                onChange={(e) => setIn({ firmName: e.target.value })}
              />
            </BvField>
            <BvField label="Target geography">
              <input
                className="bvw-inp"
                value={intake.targetGeography}
                onChange={(e) => setIn({ targetGeography: e.target.value })}
              />
            </BvField>
          </div>
          <BvField label="What does the business do, and who does it serve? (required)" full>
            <textarea
              className="bvw-inp min-h-[90px]"
              placeholder="e.g. A plaintiff-side employment law firm that helps NYC workers recover unpaid wages, fight discrimination, and negotiate severance."
              value={intake.description}
              onChange={(e) => setIn({ description: e.target.value })}
            />
          </BvField>
          <BvField label="Services / focus areas" full>
            <textarea
              className="bvw-inp min-h-[56px]"
              placeholder="Wage & hour, discrimination, wrongful termination, severance…"
              value={intake.services}
              onChange={(e) => setIn({ services: e.target.value })}
            />
          </BvField>
          <BvField label="Tone preferences / words to avoid" full>
            <input
              className="bvw-inp"
              placeholder="Confident, plain-spoken; avoid legalese and hype"
              value={intake.tonePreferences}
              onChange={(e) => setIn({ tonePreferences: e.target.value })}
            />
          </BvField>
          {lc.genError && <p className="text-sm text-red-600">{lc.genError}</p>}
        </div>
      ) : (
        settings && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              The voice guide the AI reads before drafting anything. Edit freely.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <BvField label="Business / firm name">
                <input
                  className="bvw-inp"
                  value={settings.firmName}
                  onChange={(e) => setS({ firmName: e.target.value })}
                />
              </BvField>
              <BvField label="Target geography">
                <input
                  className="bvw-inp"
                  value={settings.targetGeography}
                  onChange={(e) => setS({ targetGeography: e.target.value })}
                />
              </BvField>
            </div>
            <BvField label="Brand voice guide" full>
              <textarea
                className="bvw-inp min-h-[220px] font-mono text-xs leading-relaxed"
                value={settings.brandVoice}
                onChange={(e) => setS({ brandVoice: e.target.value })}
              />
            </BvField>
            <BvField label="Key messages" full>
              <textarea
                className="bvw-inp min-h-[90px]"
                value={settings.keyMessages}
                onChange={(e) => setS({ keyMessages: e.target.value })}
              />
            </BvField>
            <BvField label="Tone of voice" full>
              <textarea
                className="bvw-inp min-h-[70px]"
                value={settings.toneOfVoice}
                onChange={(e) => setS({ toneOfVoice: e.target.value })}
              />
            </BvField>
            {lc.saveError && (
              <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-700">
                {lc.saveError}
              </div>
            )}
          </div>
        )
      )}
    </WizardShell>
  );
}

// ===========================================================================
// 2. Avatars wizard
// ===========================================================================

type Avatar = {
  name: string;
  role: string;
  description: string;
  demographics: string;
  painPoints: string;
  goals: string;
  channels: string;
};

const EMPTY_AVATAR: Avatar = {
  name: "",
  role: "",
  description: "",
  demographics: "",
  painPoints: "",
  goals: "",
  channels: "",
};

export function AvatarsWizard({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const lc = useWizardLifecycle();
  const [intake, setIntake] = useState({ description: "", audienceNotes: "" });
  const [avatars, setAvatars] = useState<Avatar[] | null>(null);
  const [done, setDone] = useState<{ saved: number; warnings: string[] } | null>(null);

  const profile = useBrandProfile();
  useEffect(() => {
    if (!profile) return;
    setIntake((s) => ({
      description: s.description || profile.description,
      audienceNotes: s.audienceNotes || profile.audienceNotes,
    }));
  }, [profile]);

  const setIn = (p: Partial<typeof intake>) => setIntake((s) => ({ ...s, ...p }));
  const update = (i: number, p: Partial<Avatar>) =>
    setAvatars((a) => (a ? a.map((x, idx) => (idx === i ? { ...x, ...p } : x)) : a));
  const remove = (i: number) =>
    setAvatars((a) => (a ? a.filter((_, idx) => idx !== i) : a));
  const add = () => setAvatars((a) => (a ? [...a, { ...EMPTY_AVATAR }] : [{ ...EMPTY_AVATAR }]));

  const generate = async () => {
    if (!intake.description.trim()) {
      lc.setGenError("Tell us what the business does and who it serves first.");
      return;
    }
    lc.setGenError(null);
    lc.setGenerating(true);
    try {
      const res = await fetch("/api/brand-voice/wizard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "avatars", ...intake }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setAvatars(Array.isArray(data?.avatars) ? data.avatars : []);
      lc.setStep(1);
    } catch (e) {
      lc.setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      lc.setGenerating(false);
    }
  };

  const save = async () => {
    if (!avatars) return;
    lc.setSaving(true);
    lc.setSaveError(null);
    const warnings: string[] = [];
    let saved = 0;
    for (const a of avatars) {
      if (!a.name.trim()) continue;
      try {
        const res = await fetch("/api/brand-voice/avatars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: a.name.trim(),
            role: a.role.trim() || null,
            description: a.description.trim() || null,
            demographics: a.demographics.trim() || null,
            painPoints: a.painPoints.trim() || null,
            goals: a.goals.trim() || null,
            channels: a.channels.trim() || null,
          }),
        });
        if (res.ok) saved += 1;
        else {
          const d = await res.json().catch(() => ({}));
          warnings.push(`Avatar "${a.name}": ${d?.error || "failed to save"}`);
        }
      } catch {
        warnings.push(`Avatar "${a.name}": network error`);
      }
    }
    // Remember the business profile so other wizards prefill from it.
    await persistProfile({
      businessDescription: intake.description,
      businessAudience: intake.audienceNotes,
    });
    lc.setSaving(false);
    setDone({ saved, warnings });
    onSaved();
  };

  return (
    <WizardShell
      title="Audience avatars"
      subtitle="Avatar setup"
      steps={STEPS}
      step={lc.step}
      onStepClick={(i) => avatars && lc.setStep(i)}
      onClose={onClose}
      hideFooter={!!done}
      onPrev={lc.step > 0 ? () => lc.setStep(0) : null}
      primaryLabel={
        lc.step === 0
          ? lc.generating
            ? "Drafting with AI…"
            : "Generate avatars →"
          : lc.saving
            ? "Saving…"
            : "Save avatars"
      }
      primaryTone={lc.step === 0 ? "brand" : "emerald"}
      primaryDisabled={
        lc.step === 0 ? lc.generating || !intake.description.trim() : lc.saving
      }
      onPrimary={lc.step === 0 ? generate : save}
    >
      {done ? (
        <DoneScreen
          heading="Avatars saved"
          detail={`Added ${done.saved} avatar${done.saved === 1 ? "" : "s"}. They're added alongside anything already there — nothing was overwritten.`}
          warnings={done.warnings}
          onClose={onClose}
        />
      ) : lc.step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Describe who the business serves and Claude drafts 2-3 distinct
            personas — then you review and edit before saving.
          </p>
          {lc.generating && <GeneratingBanner what="your avatars" />}
          <BvField label="What does the business do, and who does it serve? (required)" full>
            <textarea
              className="bvw-inp min-h-[90px]"
              placeholder="e.g. A plaintiff-side employment law firm that helps hourly and salaried NYC/NJ workers."
              value={intake.description}
              onChange={(e) => setIn({ description: e.target.value })}
            />
          </BvField>
          <BvField label="Any specific audiences you want to reach? (optional)" full>
            <textarea
              className="bvw-inp min-h-[64px]"
              placeholder="Hourly workers, salaried professionals pushed out, small-business owners owed money…"
              value={intake.audienceNotes}
              onChange={(e) => setIn({ audienceNotes: e.target.value })}
            />
          </BvField>
          {lc.genError && <p className="text-sm text-red-600">{lc.genError}</p>}
        </div>
      ) : (
        avatars && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Personas the AI uses to tailor keyword research and content. Edit,
              drop, or add any.
            </p>
            {avatars.length === 0 && (
              <p className="text-sm italic text-slate-400">No avatars. Add one below.</p>
            )}
            {avatars.map((a, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    Avatar {idx + 1}
                  </span>
                  <button
                    onClick={() => remove(idx)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <BvField label="Name">
                    <input
                      className="bvw-inp"
                      value={a.name}
                      onChange={(e) => update(idx, { name: e.target.value })}
                    />
                  </BvField>
                  <BvField label="Role">
                    <input
                      className="bvw-inp"
                      value={a.role}
                      onChange={(e) => update(idx, { role: e.target.value })}
                    />
                  </BvField>
                </div>
                <BvField label="Description" full>
                  <textarea
                    className="bvw-inp min-h-[60px]"
                    value={a.description}
                    onChange={(e) => update(idx, { description: e.target.value })}
                  />
                </BvField>
                <div className="grid grid-cols-2 gap-3">
                  <BvField label="Demographics">
                    <textarea
                      className="bvw-inp min-h-[52px]"
                      value={a.demographics}
                      onChange={(e) => update(idx, { demographics: e.target.value })}
                    />
                  </BvField>
                  <BvField label="Preferred channels">
                    <textarea
                      className="bvw-inp min-h-[52px]"
                      value={a.channels}
                      onChange={(e) => update(idx, { channels: e.target.value })}
                    />
                  </BvField>
                  <BvField label="Pain points">
                    <textarea
                      className="bvw-inp min-h-[52px]"
                      value={a.painPoints}
                      onChange={(e) => update(idx, { painPoints: e.target.value })}
                    />
                  </BvField>
                  <BvField label="Goals">
                    <textarea
                      className="bvw-inp min-h-[52px]"
                      value={a.goals}
                      onChange={(e) => update(idx, { goals: e.target.value })}
                    />
                  </BvField>
                </div>
              </div>
            ))}
            <button
              onClick={add}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              + Add avatar
            </button>
            {lc.saveError && (
              <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-700">
                {lc.saveError}
              </div>
            )}
          </div>
        )
      )}
    </WizardShell>
  );
}

// ===========================================================================
// 3. Content Directions wizard
// ===========================================================================

type SkillType = "direction" | "voice_rule" | "do_dont" | "compliance";

const SKILL_TYPE_LABELS: { value: SkillType; label: string }[] = [
  { value: "direction", label: "Direction" },
  { value: "voice_rule", label: "Voice rule" },
  { value: "do_dont", label: "Do / don't" },
  { value: "compliance", label: "Compliance" },
];

type Direction = {
  title: string;
  skillType: SkillType;
  content: string;
  contentTypes: string[];
};

export function DirectionsWizard({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const lc = useWizardLifecycle();
  const [intake, setIntake] = useState({ description: "", tonePreferences: "" });
  const [directions, setDirections] = useState<Direction[] | null>(null);
  const [done, setDone] = useState<{ saved: number; warnings: string[] } | null>(null);

  const profile = useBrandProfile();
  useEffect(() => {
    if (!profile) return;
    setIntake((s) => ({
      description: s.description || profile.description,
      tonePreferences: s.tonePreferences || profile.tonePreferences,
    }));
  }, [profile]);

  const setIn = (p: Partial<typeof intake>) => setIntake((s) => ({ ...s, ...p }));
  const update = (i: number, p: Partial<Direction>) =>
    setDirections((d) => (d ? d.map((x, idx) => (idx === i ? { ...x, ...p } : x)) : d));
  const remove = (i: number) =>
    setDirections((d) => (d ? d.filter((_, idx) => idx !== i) : d));
  const add = () =>
    setDirections((d) => {
      const blank: Direction = { title: "", skillType: "direction", content: "", contentTypes: [] };
      return d ? [...d, blank] : [blank];
    });

  const generate = async () => {
    if (!intake.description.trim()) {
      lc.setGenError("Tell us what the business does and who it serves first.");
      return;
    }
    lc.setGenError(null);
    lc.setGenerating(true);
    try {
      const res = await fetch("/api/brand-voice/wizard/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "directions", ...intake }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setDirections(Array.isArray(data?.directions) ? data.directions : []);
      lc.setStep(1);
    } catch (e) {
      lc.setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      lc.setGenerating(false);
    }
  };

  const save = async () => {
    if (!directions) return;
    lc.setSaving(true);
    lc.setSaveError(null);
    const warnings: string[] = [];
    let saved = 0;
    for (const d of directions) {
      if (!d.title.trim() || !d.content.trim()) continue;
      try {
        const res = await fetch("/api/content/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title.trim(),
            content: d.content.trim(),
            skillType: d.skillType,
            contentTypes: d.contentTypes,
          }),
        });
        if (res.ok) saved += 1;
        else {
          const j = await res.json().catch(() => ({}));
          warnings.push(`Direction "${d.title}": ${j?.error || "failed to save"}`);
        }
      } catch {
        warnings.push(`Direction "${d.title}": network error`);
      }
    }
    // Remember the business profile so other wizards prefill from it.
    await persistProfile({
      businessDescription: intake.description,
      tonePreferences: intake.tonePreferences,
    });
    lc.setSaving(false);
    setDone({ saved, warnings });
    onSaved();
  };

  return (
    <WizardShell
      title="Content directions"
      subtitle="Directions setup"
      steps={STEPS}
      step={lc.step}
      onStepClick={(i) => directions && lc.setStep(i)}
      onClose={onClose}
      hideFooter={!!done}
      onPrev={lc.step > 0 ? () => lc.setStep(0) : null}
      primaryLabel={
        lc.step === 0
          ? lc.generating
            ? "Drafting with AI…"
            : "Generate directions →"
          : lc.saving
            ? "Saving…"
            : "Save directions"
      }
      primaryTone={lc.step === 0 ? "brand" : "emerald"}
      primaryDisabled={
        lc.step === 0 ? lc.generating || !intake.description.trim() : lc.saving
      }
      onPrimary={lc.step === 0 ? generate : save}
    >
      {done ? (
        <DoneScreen
          heading="Directions saved"
          detail={`Added ${done.saved} content direction${done.saved === 1 ? "" : "s"}. They're added alongside anything already there — nothing was overwritten.`}
          warnings={done.warnings}
          onClose={onClose}
        />
      ) : lc.step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Describe the business and Claude drafts a handful of content rules
            (voice rules, do/don&apos;ts, direction) — then you review and edit
            before saving.
          </p>
          {lc.generating && <GeneratingBanner what="your content directions" />}
          <BvField label="What does the business do, and who does it serve? (required)" full>
            <textarea
              className="bvw-inp min-h-[90px]"
              placeholder="e.g. A plaintiff-side employment law firm that helps NYC/NJ workers."
              value={intake.description}
              onChange={(e) => setIn({ description: e.target.value })}
            />
          </BvField>
          <BvField label="Voice / tone notes (optional)" full>
            <input
              className="bvw-inp"
              placeholder="Confident, plain-spoken; second person; avoid legalese"
              value={intake.tonePreferences}
              onChange={(e) => setIn({ tonePreferences: e.target.value })}
            />
          </BvField>
          {lc.genError && <p className="text-sm text-red-600">{lc.genError}</p>}
        </div>
      ) : (
        directions && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Rules injected into every matching content generation. Edit, drop,
              or add any.
            </p>
            {directions.length === 0 && (
              <p className="text-sm italic text-slate-400">No directions. Add one below.</p>
            )}
            {directions.map((d, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <BvField label="Title">
                      <input
                        className="bvw-inp"
                        value={d.title}
                        onChange={(e) => update(idx, { title: e.target.value })}
                      />
                    </BvField>
                  </div>
                  <BvField label="Type">
                    <select
                      className="bvw-inp"
                      value={d.skillType}
                      onChange={(e) => update(idx, { skillType: e.target.value as SkillType })}
                    >
                      {SKILL_TYPE_LABELS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </BvField>
                </div>
                <BvField label="Content" full>
                  <textarea
                    className="bvw-inp min-h-[80px] font-mono text-xs"
                    value={d.content}
                    onChange={(e) => update(idx, { content: e.target.value })}
                  />
                </BvField>
                <div className="flex items-center justify-between">
                  {d.contentTypes.length > 0 ? (
                    <span className="text-[11px] text-slate-500">
                      Scoped to: {d.contentTypes.join(", ")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">Applies everywhere</span>
                  )}
                  <button
                    onClick={() => remove(idx)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={add}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              + Add direction
            </button>
            {lc.saveError && (
              <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-700">
                {lc.saveError}
              </div>
            )}
          </div>
        )
      )}
    </WizardShell>
  );
}
