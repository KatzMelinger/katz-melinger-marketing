"use client";

/**
 * Brand Voice & Content Directions — the unified dashboard.
 *
 * Three sections, all driving the AI system-prompt used in keyword research
 * and content generation:
 *
 *   - Firm settings — name, geography, key messages, tone of voice
 *   - Audience avatars — personas the firm wants to reach
 *   - Content directions — skills / prompts / general direction, optionally
 *     scoped to specific platforms, audiences, or practice areas
 *
 * Content directions share the underlying content_skills table with the
 * legacy /content/skills page; this dashboard is the unified entry point.
 */

import { useEffect, useState } from "react";

import { PRACTICE_AREAS } from "@/lib/practice-areas";

type Avatar = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  created_at: string;
};

type SkillType =
  | "voice_rule"
  | "do_dont"
  | "example_phrasing"
  | "practice_fact"
  | "compliance"
  | "prompt"
  | "direction"
  | "other";

type ContentSkill = {
  id: string;
  title: string;
  skillType: SkillType;
  content: string;
  enabled: boolean;
  sortOrder: number;
  platforms: string[];
  audiences: string[];
  practiceAreas: string[];
  createdAt: string;
  updatedAt: string;
};

const SETTING_FIELDS: {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
}[] = [
  {
    key: "firmName",
    label: "Firm name",
    placeholder: "Katz Melinger PLLC",
  },
  {
    key: "targetGeography",
    label: "Target geography",
    placeholder: "New York City and New Jersey",
  },
  {
    key: "firmAddress",
    label: "Firm address (used verbatim in CTAs and signatures)",
    placeholder: "370 Lexington Avenue, Suite 1512, New York, NY 10017",
  },
  {
    key: "firmPhone",
    label: "Firm phone",
    placeholder: "(212) 460-0047",
  },
  {
    key: "firmEmail",
    label: "Firm email",
    placeholder: "info@katzmelinger.com",
  },
  {
    key: "firmWebsite",
    label: "Firm website",
    placeholder: "www.KatzMelinger.com",
  },
  {
    key: "keyMessages",
    label: "Key messages",
    placeholder:
      "What does the firm want clients to know? Practice areas, philosophy, what differentiates you.",
    multiline: true,
  },
  {
    key: "toneOfVoice",
    label: "Tone of voice",
    placeholder:
      "How should the AI sound when writing for this firm? Confident, plain-spoken, direct, etc.",
    multiline: true,
  },
];

const PLATFORMS: { id: string; label: string }[] = [
  { id: "blog", label: "Blog" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "Twitter/X" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "email", label: "Email" },
  { id: "podcast", label: "Podcast" },
];

const SKILL_TYPE_OPTIONS: {
  value: SkillType;
  label: string;
  placeholder: string;
}[] = [
  {
    value: "direction",
    label: "Direction",
    placeholder:
      "General content direction. e.g. 'When writing about wage theft, always frame the worker as someone who has been taken advantage of — never as a complainer.'",
  },
  {
    value: "prompt",
    label: "Prompt",
    placeholder:
      "Raw instructions to inject. e.g. 'Start every LinkedIn post with a one-sentence hook in second person.'",
  },
  {
    value: "voice_rule",
    label: "Voice rule",
    placeholder:
      "e.g. Always speak in second person to the worker, never about them in third person.",
  },
  {
    value: "do_dont",
    label: "Do / don't",
    placeholder:
      "DO: 'unpaid wages' — DON'T: 'wages owed'.\nDO: 'you may be entitled' — DON'T: 'you deserve'.",
  },
  {
    value: "example_phrasing",
    label: "Example phrasing",
    placeholder:
      "Sample opener: 'If your employer didn't pay you for overtime, you may be owed back wages plus liquidated damages.'",
  },
  {
    value: "practice_fact",
    label: "Practice fact",
    placeholder:
      "NY Labor Law §195 requires written notice within 10 business days of hire.",
  },
  {
    value: "compliance",
    label: "Compliance",
    placeholder:
      "Never guarantee outcomes. Always include 'past results do not guarantee future outcomes' on case-study content.",
  },
  { value: "other", label: "Other", placeholder: "Any other training snippet" },
];

function labelForType(t: SkillType): string {
  return SKILL_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

// ---------- shared primitives ----------------------------------------------

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-black/10 dark:border-white/10 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    ghost: "hover:bg-black/5 dark:hover:bg-white/10",
    outline:
      "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin ${className}`}
      style={{ width: "1em", height: "1em" }}
      aria-hidden
    >
      ◐
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
        on
          ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300"
          : "border-black/15 dark:border-white/15 hover:border-black/30 dark:hover:border-white/30"
      }`}
    >
      {children}
    </button>
  );
}

// ---------- top-level page -------------------------------------------------

export default function BrandVoicePage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(true);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);

  const loadAvatars = async () => {
    setAvatarsLoading(true);
    setAvatarsError(null);
    try {
      const res = await fetch("/api/brand-voice/avatars");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAvatars(data);
    } catch (e) {
      setAvatarsError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setAvatarsLoading(false);
    }
  };

  useEffect(() => {
    loadAvatars();
  }, []);

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Brand Voice & Content Directions
        </h1>
        <p className="text-sm opacity-70 mt-1">
          One dashboard for the firm context that drives every AI feature in
          MarketOS — keyword research, content drafting, multi-format batches,
          and review responses.
        </p>
      </div>

      <SettingsSection />
      <AvatarsSection
        avatars={avatars}
        loading={avatarsLoading}
        error={avatarsError}
        reload={loadAvatars}
        onLocalAdd={(a) => setAvatars((prev) => [...prev, a])}
        onLocalRemove={(id) => setAvatars((prev) => prev.filter((a) => a.id !== id))}
      />
      <DirectionsSection avatars={avatars} />
    </div>
  );
}

// ---------- Settings (key/value) -------------------------------------------

function SettingsSection() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brand-voice/settings");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setValues(data.settings || {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/brand-voice/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setValues(data.settings || values);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🎙</span>
        <h2 className="font-medium">Firm settings</h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm opacity-70 py-4">
          <Spinner /> Loading…
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {SETTING_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs font-medium opacity-70">{f.label}</label>
                {f.multiline ? (
                  <textarea
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[80px]"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Spinner /> : saved ? <span aria-hidden>✓</span> : <span aria-hidden>💾</span>}
              {saved ? "Saved" : "Save settings"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- Avatars --------------------------------------------------------

function AvatarsSection({
  avatars,
  loading,
  error,
  reload,
  onLocalAdd,
  onLocalRemove,
}: {
  avatars: Avatar[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  onLocalAdd: (a: Avatar) => void;
  onLocalRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", role: "", description: "" });

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/brand-voice/avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          role: draft.role.trim() || null,
          description: draft.description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add avatar");
      onLocalAdd(data);
      setDraft({ name: "", role: "", description: "" });
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/brand-voice/avatars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      onLocalRemove(id);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed");
      reload();
    }
  };

  const displayError = error ?? addError;

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>👤</span>
        <h2 className="font-medium">Audience avatars</h2>
      </div>
      <p className="text-xs opacity-70 -mt-3">
        Personas representing the kinds of clients the firm wants to attract. The
        AI uses these to tailor keyword suggestions and content. Content
        directions below can also be scoped to a specific avatar.
      </p>

      {displayError && (
        <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
          {displayError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm opacity-70 py-4">
          <Spinner /> Loading…
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {avatars.length === 0 ? (
              <p className="text-sm opacity-70 italic">No avatars yet.</p>
            ) : (
              avatars.map((a) => (
                <div
                  key={a.id}
                  className="bg-black/5 dark:bg-white/5 rounded-md p-3 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.name}</span>
                      {a.role && (
                        <span className="text-xs opacity-70">· {a.role}</span>
                      )}
                    </div>
                    {a.description && (
                      <p className="text-xs opacity-70 mt-1">{a.description}</p>
                    )}
                  </div>
                  <button
                    className="opacity-50 hover:opacity-100 hover:text-red-600 transition-colors text-base shrink-0"
                    onClick={() => handleDelete(a.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-5 space-y-3">
            <h3 className="text-sm font-medium">Add an avatar</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                placeholder="Name (e.g. Hourly Worker)"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                className="bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                placeholder="Role (e.g. Restaurant employee)"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              />
            </div>
            <textarea
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[80px]"
              placeholder="Description — situation, concerns, what they need from the firm"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <Button onClick={handleAdd} disabled={adding || !draft.name.trim()}>
              {adding ? <Spinner /> : <span aria-hidden>+</span>}
              Add avatar
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- Content directions --------------------------------------------

function DirectionsSection({ avatars }: { avatars: Avatar[] }) {
  const [directions, setDirections] = useState<ContentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [skillType, setSkillType] = useState<SkillType>("direction");
  const [content, setContent] = useState("");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [scopeAudiences, setScopeAudiences] = useState<Set<string>>(new Set());
  const [scopePracticeAreas, setScopePracticeAreas] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/skills", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const skills = (data.skills ?? []) as ContentSkill[];
      setDirections(skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggleInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) {
      setError("Title and content are required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/content/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          skillType,
          platforms: Array.from(platforms),
          audiences: Array.from(scopeAudiences),
          practiceAreas: Array.from(scopePracticeAreas),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setTitle("");
      setContent("");
      setSkillType("direction");
      setPlatforms(new Set());
      setScopeAudiences(new Set());
      setScopePracticeAreas(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  const toggleEnabled = async (d: ContentSkill, enabled: boolean) => {
    setDirections((prev) =>
      prev.map((s) => (s.id === d.id ? { ...s, enabled } : s)),
    );
    try {
      await fetch(`/api/content/skills/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      refresh();
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this direction?")) return;
    try {
      await fetch(`/api/content/skills/${id}`, { method: "DELETE" });
      setDirections((prev) => prev.filter((s) => s.id !== id));
    } catch {
      refresh();
    }
  };

  const activeType = SKILL_TYPE_OPTIONS.find((o) => o.value === skillType);
  const enabledCount = directions.filter((d) => d.enabled).length;

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>🧭</span>
        <h2 className="font-medium">Content directions</h2>
      </div>
      <p className="text-xs opacity-70 -mt-3">
        Skills, prompts, and general direction injected into every content
        generation. Scope a direction to specific platforms, audiences, or
        practice areas to keep it from firing on content where it doesn&apos;t
        belong. Empty scope = applies everywhere.
      </p>

      {error && (
        <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
          {error}
        </div>
      )}

      {/* Existing directions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Active directions</h3>
          <span className="text-xs opacity-60">
            {enabledCount} of {directions.length} active
          </span>
        </div>

        {loading && directions.length === 0 ? (
          <p className="text-sm opacity-70">Loading…</p>
        ) : directions.length === 0 ? (
          <p className="text-sm opacity-70 italic">
            No directions yet. Add one below — it will be injected into every
            matching generation.
          </p>
        ) : (
          <ul className="space-y-3">
            {directions.map((d) => (
              <li
                key={d.id}
                className={`rounded-lg border p-3 ${
                  d.enabled
                    ? "border-black/10 dark:border-white/10"
                    : "border-black/10 dark:border-white/10 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold">{d.title}</h4>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-black/15 dark:border-white/15">
                        {labelForType(d.skillType)}
                      </span>
                    </div>
                    <ScopeChips skill={d} />
                    <pre className="mt-2 text-xs opacity-80 whitespace-pre-wrap font-mono">
                      {d.content}
                    </pre>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 text-xs opacity-80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={(e) => toggleEnabled(d, e.target.checked)}
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(d.id)}
                      className="text-xs opacity-50 hover:opacity-100 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      <div className="border-t border-black/10 dark:border-white/10 pt-5 space-y-3">
        <h3 className="text-sm font-medium">Add a direction</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short name (e.g. 'LinkedIn hook style')"
            className="sm:col-span-2 bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          <select
            value={skillType}
            onChange={(e) => setSkillType(e.target.value as SkillType)}
            className="bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm"
          >
            {SKILL_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={activeType?.placeholder ?? ""}
          rows={5}
          className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
        />

        <div className="space-y-2">
          <p className="text-xs font-medium opacity-70">
            Scope (leave empty = applies everywhere)
          </p>

          <div>
            <p className="text-[11px] opacity-60 mb-1">Platforms</p>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={() => setPlatforms(new Set(["blog"]))}
                className="text-[10px] px-2 py-0.5 rounded border border-blue-500/40 bg-blue-500/5 text-blue-600 dark:text-blue-300 hover:bg-blue-500/10 font-medium"
              >
                Website
              </button>
              <button
                type="button"
                onClick={() =>
                  setPlatforms(
                    new Set([
                      "linkedin",
                      "twitter",
                      "facebook",
                      "instagram",
                      "podcast",
                    ]),
                  )
                }
                className="text-[10px] px-2 py-0.5 rounded border border-violet-500/40 bg-violet-500/5 text-violet-600 dark:text-violet-300 hover:bg-violet-500/10 font-medium"
              >
                Social media
              </button>
              <button
                type="button"
                onClick={() => setPlatforms(new Set(["email"]))}
                className="text-[10px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 font-medium"
              >
                Email
              </button>
              {platforms.size > 0 && (
                <button
                  type="button"
                  onClick={() => setPlatforms(new Set())}
                  className="text-[10px] px-2 py-0.5 rounded border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <Chip
                  key={p.id}
                  on={platforms.has(p.id)}
                  onClick={() => toggleInSet(setPlatforms, p.id)}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] opacity-60 mb-1">Audiences</p>
            <div className="flex flex-wrap gap-1.5">
              {avatars.length === 0 ? (
                <span className="text-xs opacity-60 italic">
                  Add audience avatars above to scope by audience.
                </span>
              ) : (
                avatars.map((a) => (
                  <Chip
                    key={a.id}
                    on={scopeAudiences.has(a.name)}
                    onClick={() => toggleInSet(setScopeAudiences, a.name)}
                  >
                    {a.name}
                  </Chip>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] opacity-60 mb-1">Practice areas</p>
            <div className="flex flex-wrap gap-1.5">
              {PRACTICE_AREAS.filter((p) => p !== "General").map((p) => (
                <Chip
                  key={p}
                  on={scopePracticeAreas.has(p)}
                  onClick={() => toggleInSet(setScopePracticeAreas, p)}
                >
                  {p}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner /> : <span aria-hidden>+</span>}
            Add direction
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ScopeChips({ skill }: { skill: ContentSkill }) {
  const hasScope =
    skill.platforms.length > 0 ||
    skill.audiences.length > 0 ||
    skill.practiceAreas.length > 0;
  if (!hasScope) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
      {skill.platforms.map((p) => (
        <span
          key={`p-${p}`}
          className="rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-blue-600 dark:text-blue-300"
        >
          📱 {p}
        </span>
      ))}
      {skill.audiences.map((a) => (
        <span
          key={`a-${a}`}
          className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-600 dark:text-violet-300"
        >
          👤 {a}
        </span>
      ))}
      {skill.practiceAreas.map((pa) => (
        <span
          key={`pa-${pa}`}
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300"
        >
          ⚖ {pa}
        </span>
      ))}
    </div>
  );
}
