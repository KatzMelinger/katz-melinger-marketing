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

type TabKey = "settings" | "avatars" | "directions" | "samples";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "settings", label: "Brand settings", icon: "🎙" },
  { key: "avatars", label: "Audience avatars", icon: "👤" },
  { key: "directions", label: "Content directions", icon: "🧭" },
  { key: "samples", label: "Writing samples", icon: "📄" },
];

type Avatar = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  demographics: string | null;
  pain_points: string | null;
  goals: string | null;
  channels: string | null;
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
  rows?: number;
  help?: string;
}[] = [
  {
    key: "brandVoice",
    label: "Brand voice guide",
    placeholder:
      "The full brand-voice guide. Tone, rules, audience, how legal ideas should be explained, hooks/CTAs, etc.",
    multiline: true,
    rows: 22,
    help: "The primary voice document. The AI reads this before drafting anything.",
  },
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
  const [tab, setTab] = useState<TabKey>("settings");
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

      <div className="flex flex-wrap gap-1 border-b border-black/10 dark:border-white/10">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "settings" && <SettingsSection />}
      {tab === "avatars" && (
        <AvatarsSection
          avatars={avatars}
          loading={avatarsLoading}
          error={avatarsError}
          reload={loadAvatars}
          onLocalAdd={(a) => setAvatars((prev) => [...prev, a])}
          onLocalRemove={(id) => setAvatars((prev) => prev.filter((a) => a.id !== id))}
        />
      )}
      {tab === "directions" && <DirectionsSection avatars={avatars} />}
      {tab === "samples" && <WritingSamplesSection />}
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
            {SETTING_FIELDS.map((f) => {
              const value = values[f.key] ?? "";
              const showCount = f.multiline && (f.rows ?? 0) >= 6;
              const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
              return (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium opacity-70">{f.label}</label>
                  {f.help && <p className="text-xs opacity-60">{f.help}</p>}
                  {f.multiline ? (
                    <textarea
                      rows={f.rows}
                      className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[80px]"
                      placeholder={f.placeholder}
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder={f.placeholder}
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  )}
                  {showCount && (
                    <div className="text-[10px] opacity-50 text-right">
                      {wordCount.toLocaleString()} words · {value.length.toLocaleString()} chars
                    </div>
                  )}
                </div>
              );
            })}
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
  const EMPTY_DRAFT = {
    name: "",
    role: "",
    description: "",
    demographics: "",
    painPoints: "",
    goals: "",
    channels: "",
  };
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showMore, setShowMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role.trim() || null,
        description: draft.description.trim() || null,
        demographics: draft.demographics.trim() || null,
        painPoints: draft.painPoints.trim() || null,
        goals: draft.goals.trim() || null,
        channels: draft.channels.trim() || null,
      };
      const res = editingId
        ? await fetch("/api/brand-voice/avatars", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, ...payload }),
          })
        : await fetch("/api/brand-voice/avatars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save avatar");
      if (editingId) {
        reload();
      } else {
        onLocalAdd(data);
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setShowMore(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (a: Avatar) => {
    setDraft({
      name: a.name,
      role: a.role ?? "",
      description: a.description ?? "",
      demographics: a.demographics ?? "",
      painPoints: a.pain_points ?? "",
      goals: a.goals ?? "",
      channels: a.channels ?? "",
    });
    setEditingId(a.id);
    setShowMore(true);
    setAddError(null);
  };

  const cancelEdit = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setShowMore(false);
    setAddError(null);
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
                <AvatarRow
                  key={a.id}
                  avatar={a}
                  onEdit={() => handleEdit(a)}
                  onDelete={() => handleDelete(a.id)}
                />
              ))
            )}
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-5 space-y-3">
            <h3 className="text-sm font-medium">
              {editingId ? "Edit avatar" : "Add an avatar"}
            </h3>
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
              rows={4}
              className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Description — situation, concerns, what they need from the firm"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="text-xs opacity-60 hover:opacity-100 underline"
            >
              {showMore ? "Hide" : "Show"} more details (demographics, pain points, goals, channels)
            </button>

            {showMore && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <label className="text-[11px] opacity-70">Demographics</label>
                  <textarea
                    rows={2}
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g., 30–55 years old, NYC/NJ area, household income $60–150K"
                    value={draft.demographics}
                    onChange={(e) => setDraft({ ...draft, demographics: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] opacity-70">Pain points</label>
                  <textarea
                    rows={3}
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="What problems or frustrations does this person face?"
                    value={draft.painPoints}
                    onChange={(e) => setDraft({ ...draft, painPoints: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] opacity-70">Goals</label>
                  <textarea
                    rows={3}
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="What is this person trying to achieve?"
                    value={draft.goals}
                    onChange={(e) => setDraft({ ...draft, goals: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] opacity-70">Preferred channels</label>
                  <input
                    className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g., Google search, LinkedIn, Reddit, email newsletters"
                    value={draft.channels}
                    onChange={(e) => setDraft({ ...draft, channels: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleAdd} disabled={adding || !draft.name.trim()}>
                {adding ? <Spinner /> : <span aria-hidden>{editingId ? "💾" : "+"}</span>}
                {editingId ? "Save changes" : "Add avatar"}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- Avatar row -----------------------------------------------------

function AvatarRow({
  avatar,
  onEdit,
  onDelete,
}: {
  avatar: Avatar;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    avatar.demographics || avatar.pain_points || avatar.goals || avatar.channels;
  const desc = avatar.description ?? "";
  const isLong = desc.length > 200 || desc.includes("\n") || hasDetails;

  return (
    <div className="bg-black/5 dark:bg-white/5 rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{avatar.name}</span>
            {avatar.role && (
              <span className="text-xs opacity-70">· {avatar.role}</span>
            )}
          </div>
          {desc && !expanded && (
            <p className="text-xs opacity-70 mt-1 line-clamp-2 whitespace-pre-wrap">
              {desc}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="text-xs opacity-60 hover:opacity-100 underline px-1"
            onClick={onEdit}
            title="Edit"
          >
            ✎
          </button>
          <button
            className="opacity-50 hover:opacity-100 hover:text-red-600 transition-colors text-base"
            onClick={onDelete}
            title="Delete"
          >
            ×
          </button>
        </div>
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] opacity-60 hover:opacity-100 underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {expanded && (
        <div className="text-xs space-y-2 pt-1">
          {desc && (
            <DetailLine label="Description" value={desc} />
          )}
          <DetailLine label="Demographics" value={avatar.demographics} />
          <DetailLine label="Pain points" value={avatar.pain_points} />
          <DetailLine label="Goals" value={avatar.goals} />
          <DetailLine label="Preferred channels" value={avatar.channels} />
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="opacity-60">{label}:</span>{" "}
      <span className="whitespace-pre-wrap opacity-90">{value}</span>
    </div>
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

// ---------- Writing samples -----------------------------------------------
// Real example pieces of content per content type. The AI uses one excerpt
// per type as tone reference. Storage: brand_voice_samples table (see
// supabase/brand_voice_v2_schema.sql).

type Sample = {
  id: string;
  title: string;
  content: string;
  content_type: string;
  notes: string | null;
  created_at: string;
};

const SAMPLE_CONTENT_TYPES = [
  "Blog Post",
  "Social Media Post",
  "Email Newsletter",
  "Website Copy",
  "Case Study",
  "FAQ Answer",
  "Landing Page",
  "Press Release",
  "Video Script",
  "Other",
];

function WritingSamplesSection() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("All");
  const [draft, setDraft] = useState({
    title: "",
    content: "",
    contentType: "Blog Post",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/brand-voice/samples");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setSamples(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/brand-voice/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          content: draft.content,
          contentType: draft.contentType,
          notes: draft.notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save sample");
      setDraft({ title: "", content: "", contentType: "Blog Post", notes: "" });
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this sample?")) return;
    setError(null);
    try {
      const res = await fetch("/api/brand-voice/samples", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const filtered = filter === "All" ? samples : samples.filter((s) => s.content_type === filter);
  const typesInUse = Array.from(new Set(samples.map((s) => s.content_type))).sort();

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden>📄</span>
          <h2 className="font-medium">Writing samples</h2>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <span aria-hidden>+</span>
            Add sample
          </Button>
        )}
      </div>
      <p className="text-xs opacity-70 -mt-3">
        Real examples of content the firm likes, tagged by content type. The AI
        uses one excerpt per type as tone reference when drafting new content.
      </p>

      {error && (
        <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
          {error}
        </div>
      )}

      {showForm && (
        <div className="border border-foreground/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">New writing sample</h3>
            <button
              onClick={() => setShowForm(false)}
              className="opacity-50 hover:opacity-100 text-lg"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Title (e.g. FMLA Rights Blog Post)"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <select
              className="bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              value={draft.contentType}
              onChange={(e) => setDraft({ ...draft, contentType: e.target.value })}
            >
              {SAMPLE_CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={14}
            className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            placeholder="Paste the full writing sample here…"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <input
            className="w-full bg-transparent border border-black/15 dark:border-white/15 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            placeholder="Notes (optional, e.g. 'Ideal tone for blog posts')"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || !draft.title.trim() || !draft.content.trim()}
            >
              {saving ? <Spinner /> : <span aria-hidden>💾</span>}
              Save sample
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {samples.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {["All", ...typesInUse].map((t) => (
            <Chip key={t} on={filter === t} onClick={() => setFilter(t)}>
              {t}
              {t !== "All" && (
                <span className="ml-1 opacity-60">
                  {samples.filter((s) => s.content_type === t).length}
                </span>
              )}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm opacity-70 py-4">
          <Spinner /> Loading…
        </div>
      ) : filtered.length === 0 && !showForm ? (
        <p className="text-sm opacity-70 italic">No writing samples yet.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <SampleRow key={s.id} sample={s} onDelete={() => handleDelete(s.id)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SampleRow({ sample, onDelete }: { sample: Sample; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-black/5 dark:bg-white/5 rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left min-w-0"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{sample.title}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-foreground/10">
              {sample.content_type}
            </span>
          </div>
          {sample.notes && (
            <p className="text-xs opacity-70 mt-1">{sample.notes}</p>
          )}
        </button>
        <button
          className="opacity-50 hover:opacity-100 hover:text-red-600 transition-colors text-base shrink-0"
          onClick={onDelete}
          title="Delete"
        >
          ×
        </button>
      </div>
      {expanded ? (
        <pre className="text-xs whitespace-pre-wrap bg-foreground/5 rounded-md p-3 font-sans">
          {sample.content}
        </pre>
      ) : (
        <p className="text-xs opacity-70 line-clamp-3 whitespace-pre-wrap">
          {sample.content}
        </p>
      )}
    </div>
  );
}
