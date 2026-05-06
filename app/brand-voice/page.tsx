"use client";

/**
 * Brand Voice page for MarketOS.
 *
 * Edits the firm-level context that gets injected into the system prompt of
 * every AI keyword research call. Two sections:
 *
 *   - Firm settings — flat key/value text fields. Backed by /api/brand-voice/settings.
 *   - Audience avatars — target client personas. Backed by /api/brand-voice/avatars.
 *
 * Uses plain Tailwind utilities only — no shadcn UI primitives, no lucide
 * icons. Matches the rest of MarketOS.
 */

import { useEffect, useState } from "react";

type Avatar = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  created_at: string;
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

// ---------- top-level page -------------------------------------------------

export default function BrandVoicePage() {
  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand Voice</h1>
        <p className="text-sm opacity-70 mt-1">
          The firm context that drives every AI feature in MarketOS — keyword
          research, content drafting, and review responses.
        </p>
      </div>

      <SettingsSection />
      <AvatarsSection />
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
      } catch (e: any) {
        setError(e.message);
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
    } catch (e: any) {
      setError(e.message);
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

function AvatarsSection() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", role: "", description: "" });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/brand-voice/avatars");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAvatars(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setAdding(true);
    setError(null);
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
      setAvatars((prev) => [...prev, data]);
      setDraft({ name: "", role: "", description: "" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
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
      setAvatars((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <span aria-hidden>👤</span>
        <h2 className="font-medium">Audience avatars</h2>
      </div>
      <p className="text-xs opacity-70 -mt-3">
        Personas representing the kinds of clients the firm wants to attract. The
        AI uses these to tailor keyword suggestions and content.
      </p>

      {error && (
        <div className="text-red-700 dark:text-red-400 text-sm bg-red-500/10 p-3 rounded-md">
          {error}
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