"use client";

/**
 * Skills management — reusable training snippets that get injected into every
 * Content Studio generation. Add voice rules, do/don't lists, example
 * phrasings, practice-area facts, compliance language, etc. Toggle individual
 * skills on/off without deleting them. Reorder via the sort number.
 */

import { useEffect, useState } from "react";

import { ContentNav } from "@/components/content-nav";
import { MarketingNav } from "@/components/marketing-nav";

type Skill = {
  id: string;
  title: string;
  skill_type:
    | "voice_rule"
    | "do_dont"
    | "example_phrasing"
    | "practice_fact"
    | "compliance"
    | "other";
  content: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type SkillType = Skill["skill_type"];

const TYPE_OPTIONS: { value: SkillType; label: string; placeholder: string }[] = [
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
      "NY Labor Law §195 requires written notice within 10 business days of hire. Use this when discussing wage theft.",
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
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [skillType, setSkillType] = useState<SkillType>("voice_rule");
  const [content, setContent] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/skills", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setSkills((data.skills ?? []) as Skill[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
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
        body: JSON.stringify({ title, content, skillType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setTitle("");
      setContent("");
      setSkillType("voice_rule");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
    );
    try {
      await fetch(`/api/content/skills/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      refresh();
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this skill?")) return;
    try {
      await fetch(`/api/content/skills/${id}`, { method: "DELETE" });
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch {
      refresh();
    }
  };

  const placeholder =
    TYPE_OPTIONS.find((o) => o.value === skillType)?.placeholder ?? "";
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Reusable training snippets injected into every Content Studio
            generation. Voice rules, do/don'ts, example phrasings, practice
            facts, compliance reminders — anything you'd otherwise re-paste
            into every prompt.
          </p>
        </section>

        <ContentNav />

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-lg font-semibold">Add a skill</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short name (e.g. 'Plaintiff-side voice')"
              className="sm:col-span-2 px-3 py-2 text-sm rounded-md border border-slate-200 focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
            />
            <select
              value={skillType}
              onChange={(e) => setSkillType(e.target.value as SkillType)}
              className="px-3 py-2 text-sm rounded-md border border-slate-200"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-200 focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 font-mono"
          />
          <div className="flex items-center justify-between gap-3">
            {error && <span className="text-sm text-red-700">{error}</span>}
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="ml-auto rounded-md bg-[#185FA5] text-white px-4 py-2 text-sm font-medium hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              {creating ? "Saving…" : "Add skill"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active skills</h2>
            <span className="text-xs text-slate-500">
              {enabledCount} of {skills.length} active
            </span>
          </header>

          {loading && skills.length === 0 ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : skills.length === 0 ? (
            <p className="text-sm text-slate-500">
              No skills yet. Add one above and it will be prepended to every
              content generation.
            </p>
          ) : (
            <ul className="space-y-3">
              {skills.map((s) => (
                <li
                  key={s.id}
                  className={`rounded-lg border p-4 ${
                    s.enabled
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50 opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold">{s.title}</h3>
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-600">
                          {labelForType(s.skill_type)}
                        </span>
                      </div>
                      <pre className="mt-2 text-xs text-slate-700 whitespace-pre-wrap font-mono">
                        {s.content}
                      </pre>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => toggle(s.id, e.target.checked)}
                        />
                        Active
                      </label>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
