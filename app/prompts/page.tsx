"use client";

/**
 * Prompts workspace.
 *
 * Master/detail layout:
 *   - Left: project tree + flat prompt list with search
 *   - Right: selected prompt editor + variable form + run output + history
 *
 * MVP scope: single-model (Claude). Each run persists to ai_prompt_runs
 * with usage + cost estimate.
 */

import { useEffect, useMemo, useState } from "react";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type Project = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type PromptListItem = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  variables: string[];
  model: string;
  max_tokens: number;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type Prompt = PromptListItem & {
  system_prompt: string | null;
  user_prompt: string;
};

type Run = {
  id: string;
  variables: Record<string, string>;
  output: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_estimate: number | null;
  latency_ms: number | null;
  status: "success" | "failed";
  error: string | null;
  created_at: string;
};

const DEFAULT_USER_PROMPT = `Write a {{tone}} explainer about {{topic}} for {{audience}}.

Length: {{length}} words.`;

export default function PromptsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = async () => {
    const res = await fetch("/api/prompts/projects");
    const data = await res.json();
    setProjects(data.projects ?? []);
  };

  const refreshPrompts = async () => {
    const res = await fetch("/api/prompts");
    const data = await res.json();
    setPrompts(data.prompts ?? []);
  };

  useEffect(() => {
    refreshProjects();
    refreshPrompts();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    fetch(`/api/prompts/${selectedId}`)
      .then((r) => r.json())
      .then((d) => setSelected(d.prompt ?? null));
  }, [selectedId]);

  const filtered = useMemo(() => {
    return prompts.filter((p) => {
      if (filterProject !== "all" && p.project_id !== filterProject) {
        if (filterProject === "none" && p.project_id !== null) return false;
        if (filterProject !== "none") return false;
      }
      if (search.trim()) {
        const lc = search.toLowerCase();
        return (
          p.title.toLowerCase().includes(lc) ||
          (p.description ?? "").toLowerCase().includes(lc) ||
          p.tags.some((t) => t.toLowerCase().includes(lc))
        );
      }
      return true;
    });
  }, [prompts, search, filterProject]);

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prompts workspace</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Save reusable prompt templates with{" "}
            <code className="text-xs px-1 py-0.5 rounded bg-slate-100 border border-slate-200">
              {"{{variables}}"}
            </code>
            , organize them into projects, run them on demand, and review every
            past execution with cost estimates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DashButton variant="outline" onClick={() => setShowNewProject(true)}>
            + Project
          </DashButton>
          <DashButton onClick={() => setShowNewPrompt(true)}>+ Prompt</DashButton>
        </div>
      </div>

      {error && (
        <div className="mb-4 border border-red-200 bg-red-50 text-red-800 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-3">
          <DashCard padding="p-3">
            <DashInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts…"
              className="w-full"
            />
            <DashSelect
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="w-full mt-2"
            >
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </DashSelect>
          </DashCard>

          {projects.length > 0 && (
            <DashCard padding="p-3">
              <div className="text-xs font-medium text-slate-700 mb-2">Projects</div>
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setFilterProject(p.id)}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                      filterProject === p.id
                        ? "bg-[#185FA5]/10 text-[#185FA5] font-semibold"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {p.name}
                    <span className="ml-2 text-slate-400">
                      ({prompts.filter((pr) => pr.project_id === p.id).length})
                    </span>
                  </button>
                ))}
              </div>
            </DashCard>
          )}

          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-4">No prompts.</p>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                  selectedId === p.id
                    ? "border-[#185FA5] bg-[#185FA5]/5"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="text-sm font-medium line-clamp-1">{p.title}</div>
                {p.description && (
                  <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">{p.description}</div>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.variables.length > 0 && (
                    <DashPill tone="violet">{p.variables.length} vars</DashPill>
                  )}
                  {p.tags.slice(0, 3).map((t, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected && !selectedId && (
            <DashCard className="text-center text-sm text-slate-500 py-12">
              Pick a prompt from the list, or click <span className="font-medium">+ Prompt</span>{" "}
              to create one.
            </DashCard>
          )}
          {selectedId && !selected && (
            <DashCard className="text-center py-8">
              <DashSpinner /> Loading prompt…
            </DashCard>
          )}
          {selected && (
            <PromptEditor
              prompt={selected}
              projects={projects}
              onSaved={(updated) => {
                setSelected(updated);
                refreshPrompts();
              }}
              onDeleted={() => {
                setSelected(null);
                setSelectedId(null);
                refreshPrompts();
              }}
            />
          )}
        </div>
      </div>

      {showNewPrompt && (
        <NewPromptModal
          projects={projects}
          onClose={() => setShowNewPrompt(false)}
          onCreated={(id) => {
            setShowNewPrompt(false);
            setSelectedId(id);
            refreshPrompts();
          }}
        />
      )}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={() => {
            setShowNewProject(false);
            refreshProjects();
          }}
        />
      )}
    </div>
  );
}

function PromptEditor({
  prompt,
  projects,
  onSaved,
  onDeleted,
}: {
  prompt: Prompt;
  projects: Project[];
  onSaved: (p: Prompt) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(prompt.title);
  const [description, setDescription] = useState(prompt.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(prompt.system_prompt ?? "");
  const [userPrompt, setUserPrompt] = useState(prompt.user_prompt);
  const [model, setModel] = useState(prompt.model);
  const [maxTokens, setMaxTokens] = useState(prompt.max_tokens);
  const [projectId, setProjectId] = useState<string>(prompt.project_id ?? "");
  const [tags, setTags] = useState(prompt.tags.join(", "));
  const [saving, setSaving] = useState(false);

  // Variables
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    output: string;
    input_tokens: number;
    output_tokens: number;
    cost_estimate: number;
    latency_ms: number;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [runs, setRuns] = useState<Run[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Re-extract variables on the fly so the run form updates as you edit.
  const variables = useMemo(() => {
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    const seen = new Set<string>();
    for (const src of [systemPrompt, userPrompt]) {
      let m: RegExpExecArray | null;
      const r = new RegExp(re.source, "g");
      while ((m = r.exec(src)) !== null) seen.add(m[1]);
    }
    return Array.from(seen);
  }, [systemPrompt, userPrompt]);

  // Keep varValues in sync with current variable list (drop removed, add new).
  useEffect(() => {
    setVarValues((prev) => {
      const next: Record<string, string> = {};
      for (const v of variables) next[v] = prev[v] ?? "";
      return next;
    });
  }, [variables]);

  useEffect(() => {
    setTitle(prompt.title);
    setDescription(prompt.description ?? "");
    setSystemPrompt(prompt.system_prompt ?? "");
    setUserPrompt(prompt.user_prompt);
    setModel(prompt.model);
    setMaxTokens(prompt.max_tokens);
    setProjectId(prompt.project_id ?? "");
    setTags(prompt.tags.join(", "));
    setResult(null);
    setRunError(null);
  }, [prompt.id]);

  const refreshHistory = async () => {
    const res = await fetch(`/api/prompts/${prompt.id}/runs`);
    const data = await res.json();
    setRuns(data.runs ?? []);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${prompt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          system_prompt: systemPrompt || null,
          user_prompt: userPrompt,
          model,
          max_tokens: Number(maxTokens),
          project_id: projectId || null,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok) onSaved(data.prompt);
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/prompts/${prompt.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: varValues }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunError(data?.error || "Run failed");
        return;
      }
      setResult(data);
      refreshHistory();
    } finally {
      setRunning(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete prompt "${prompt.title}"?`)) return;
    await fetch(`/api/prompts/${prompt.id}`, { method: "DELETE" });
    onDeleted();
  };

  return (
    <div className="space-y-4">
      <DashCard>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-semibold flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-[#185FA5] focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <DashButton onClick={save} disabled={saving}>
              {saving ? <DashSpinner /> : "Save"}
            </DashButton>
            <button
              onClick={remove}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        <DashInput
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (what does this prompt do?)"
          className="w-full mb-3"
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div>
            <label className="text-[11px] font-medium text-slate-700">Project</label>
            <DashSelect
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full mt-1"
            >
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </DashSelect>
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-700">Model</label>
            <DashSelect
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full mt-1"
            >
              <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              <option value="claude-opus-4-7">Claude Opus 4.7</option>
            </DashSelect>
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-700">Max tokens</label>
            <DashInput
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-700">Tags (comma-separated)</label>
            <DashInput
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full mt-1"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-700">
              System prompt (optional)
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="Instructions that shape the model's role/behavior."
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">
              User prompt — use {"{{variable_name}}"} for inputs
            </label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={10}
              placeholder={DEFAULT_USER_PROMPT}
              className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
            />
          </div>
        </div>
      </DashCard>

      <DashCard>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold">Run</h3>
          <span className="text-[11px] text-slate-500">
            {variables.length} variable{variables.length === 1 ? "" : "s"}
          </span>
        </div>
        {variables.length === 0 ? (
          <p className="text-xs text-slate-500 italic mb-3">
            No variables in this prompt — clicking Run executes it as-is.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            {variables.map((v) => (
              <div key={v}>
                <label className="text-[11px] font-medium text-slate-700">
                  <code className="font-mono text-[#185FA5]">{`{{${v}}}`}</code>
                </label>
                <DashInput
                  value={varValues[v] ?? ""}
                  onChange={(e) =>
                    setVarValues((prev) => ({ ...prev, [v]: e.target.value }))
                  }
                  className="w-full mt-1"
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <DashButton onClick={run} disabled={running}>
            {running ? <DashSpinner /> : "Run prompt"}
          </DashButton>
          <button
            onClick={() => {
              setShowHistory((s) => !s);
              if (!showHistory) refreshHistory();
            }}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:border-slate-400"
          >
            {showHistory ? "Hide history" : "History"}
          </button>
        </div>
        {runError && <p className="text-sm text-red-700 mt-2">{runError}</p>}

        {result && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[#185FA5]">Output</span>
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-3">
                <span>
                  <strong>{result.input_tokens}</strong> in
                </span>
                <span>
                  <strong>{result.output_tokens}</strong> out
                </span>
                <span>${result.cost_estimate.toFixed(4)}</span>
                <span>{result.latency_ms}ms</span>
              </div>
            </div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-md p-3 border border-slate-200">
              {result.output}
            </div>
          </div>
        )}

        {showHistory && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">Run history</h4>
            {runs.length === 0 ? (
              <p className="text-xs text-slate-500">No runs yet.</p>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => (
                  <RunItem key={r.id} run={r} />
                ))}
              </div>
            )}
          </div>
        )}
      </DashCard>
    </div>
  );
}

function RunItem({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-md">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <DashPill tone={run.status === "success" ? "emerald" : "red"}>{run.status}</DashPill>
          <span className="text-xs text-slate-500">
            {new Date(run.created_at).toLocaleString()}
          </span>
          {run.cost_estimate != null && (
            <span className="text-[11px] text-slate-500">
              ${run.cost_estimate.toFixed(4)}
            </span>
          )}
          {run.latency_ms != null && (
            <span className="text-[11px] text-slate-500">{run.latency_ms}ms</span>
          )}
        </div>
        <span className="text-xs text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-200">
          {Object.keys(run.variables).length > 0 && (
            <div className="text-[11px]">
              <div className="font-medium text-slate-700 mb-1">Variables</div>
              <div className="space-y-0.5">
                {Object.entries(run.variables).map(([k, v]) => (
                  <div key={k}>
                    <code className="text-[#185FA5]">{`{{${k}}}`}</code>:{" "}
                    <span className="text-slate-700">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {run.output && (
            <div>
              <div className="text-[11px] font-medium text-slate-700 mb-1">Output</div>
              <div className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded p-2 border border-slate-200">
                {run.output}
              </div>
            </div>
          )}
          {run.error && <p className="text-xs text-red-700">{run.error}</p>}
        </div>
      )}
    </div>
  );
}

function NewPromptModal({
  projects,
  onClose,
  onCreated,
}: {
  projects: Project[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || !userPrompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          user_prompt: userPrompt,
          project_id: projectId || null,
        }),
      });
      const data = await res.json();
      if (res.ok) onCreated(data.prompt.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="New prompt">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-700">Title</label>
          <DashInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Blog post outline"
            className="w-full mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Project (optional)</label>
          <DashSelect
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full mt-1"
          >
            <option value="">— None —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </DashSelect>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">User prompt</label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            rows={8}
            className="w-full mt-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5]"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DashButton variant="outline" onClick={onClose}>
            Cancel
          </DashButton>
          <DashButton onClick={create} disabled={saving || !title.trim() || !userPrompt.trim()}>
            {saving ? <DashSpinner /> : "Create"}
          </DashButton>
        </div>
      </div>
    </Modal>
  );
}

function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/prompts/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (res.ok) onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="New project">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-700">Name</label>
          <DashInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q1 Severance Campaign"
            className="w-full mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Description</label>
          <DashInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this project for?"
            className="w-full mt-1"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DashButton variant="outline" onClick={onClose}>
            Cancel
          </DashButton>
          <DashButton onClick={create} disabled={saving || !name.trim()}>
            {saving ? <DashSpinner /> : "Create"}
          </DashButton>
        </div>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl"
        >
          ×
        </button>
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
