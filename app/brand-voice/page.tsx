"use client";

/**
 * Brand Voice page for MarketOS.
 *
 * Edits the firm-level context that gets injected into the system prompt of
 * every AI keyword research call. Two sections:
 *
 *   - Firm settings — flat key/value text fields (firmName, targetGeography,
 *     keyMessages, toneOfVoice). Backed by /api/brand-voice/settings.
 *
 *   - Audience avatars — target client personas with name/role/description.
 *     Backed by /api/brand-voice/avatars.
 *
 * Future MarketOS features (content drafting, ad copy, etc.) can read from
 * these same tables, so this page is the single source of truth for firm voice.
 */

import { useEffect, useState } from "react";
import {
  Loader2,
  Save,
  Plus,
  Trash2,
  User,
  Mic,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Avatar = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  created_at: string;
};

const SETTING_FIELDS: { key: string; label: string; placeholder: string; multiline?: boolean }[] = [
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
      "What does the firm want clients to know? Practice areas, philosophy, " +
      "what differentiates you.",
    multiline: true,
  },
  {
    key: "toneOfVoice",
    label: "Tone of voice",
    placeholder:
      "How should the AI sound when writing for this firm? Confident, plain-spoken, " +
      "direct, etc.",
    multiline: true,
  },
];

export default function BrandVoicePage() {
  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand Voice</h1>
        <p className="text-sm text-muted-foreground mt-1">
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
        <Mic className="w-4 h-4 text-primary" />
        <h2 className="font-medium">Firm settings</h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {SETTING_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {f.label}
                </label>
                {f.multiline ? (
                  <textarea
                    className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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
            <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
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
        <User className="w-4 h-4 text-primary" />
        <h2 className="font-medium">Audience avatars</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        Personas representing the kinds of clients the firm wants to attract. The
        AI uses these to tailor keyword suggestions and content.
      </p>

      {error && (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {avatars.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No avatars yet.</p>
            ) : (
              avatars.map((a) => (
                <div
                  key={a.id}
                  className="bg-muted/30 rounded-lg p-3 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.name}</span>
                      {a.role && (
                        <span className="text-xs text-muted-foreground">
                          · {a.role}
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => handleDelete(a.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border pt-5 space-y-3">
            <h3 className="text-sm font-medium">Add an avatar</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Name (e.g. Hourly Worker)"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                className="bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Role (e.g. Restaurant employee)"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              />
            </div>
            <textarea
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]"
              placeholder="Description — situation, concerns, what they need from the firm"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <Button
              onClick={handleAdd}
              disabled={adding || !draft.name.trim()}
              className="gap-2"
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add avatar
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
