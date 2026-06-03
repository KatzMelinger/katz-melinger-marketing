"use client";

/**
 * KM Agent — chat front-end for /api/agent.
 *
 * One front door to every intelligence tool the dashboard exposes: trending
 * topics, topic ideas, social playbooks, tracked-keyword status, active
 * recommendations, AutoPilot queue. Claude reasons about which to call.
 *
 * History is kept in localStorage (key: km_agent_conversation) so a refresh
 * doesn't lose context. "New chat" clears it. No backend persistence yet —
 * upgrade path is documented in lib/recent-trends.ts comments.
 */

import { useEffect, useRef, useState } from "react";

import {
  DashCard,
  DashButton,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Step =
  | { type: "assistant_text"; text: string }
  | {
      type: "tool_call";
      tool: string;
      input: unknown;
      output: unknown;
    };

const STORAGE_KEY = "km_agent_conversation";

const SUGGESTIONS = [
  "What's trending in NY/NJ employment law this month?",
  "List my top 5 active recommendations by impact.",
  "Show tracked keywords that dropped in rank since last check.",
  "Give me a TikTok playbook for the latest pregnancy-discrimination ruling.",
  "What's in my AutoPilot queue waiting for approval?",
];

function loadHistory(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* quota / disabled */
  }
}

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSteps, setLastSteps] = useState<Step[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Lets the Stop button abort an in-progress /api/agent request.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages(loadHistory());
  }, []);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, lastSteps, loading]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const nextHistory: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(nextHistory);
    setInput("");
    setLoading(true);
    setError(null);
    setLastSteps([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        text?: string;
        steps?: Step[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "agent failed");
      const reply = data.text?.trim() || "(no reply)";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      setLastSteps(data.steps ?? []);
    } catch (e) {
      // User hit Stop — not an error; just note it and keep their message.
      if (e instanceof DOMException && e.name === "AbortError") {
        setMessages((m) => [...m, { role: "assistant", content: "⏹ Stopped." }]);
      } else {
        setError(e instanceof Error ? e.message : "agent error");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const reset = () => {
    setMessages([]);
    setLastSteps([]);
    setError(null);
    saveHistory([]);
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">KM Agent</h1>
          <p className="text-sm text-slate-600 mt-1">
            Chat-driven access to every intelligence tool in MarketOS — trending
            topics, recommendations, tracked keywords, the AutoPilot queue, more.
            Claude decides which tools to call.
          </p>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={reset}
            className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-700"
          >
            New chat
          </button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="space-y-3 mb-4 max-h-[60vh] overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <DashCard>
            <p className="text-sm text-slate-600 mb-3">
              Try one of these to get started:
            </p>
            <ul className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="text-left w-full text-sm text-[#185FA5] hover:bg-[#185FA5]/5 rounded px-2 py-1.5"
                  >
                    → {s}
                  </button>
                </li>
              ))}
            </ul>
          </DashCard>
        ) : null}

        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-lg bg-[#185FA5] text-white px-3 py-2 text-sm whitespace-pre-wrap"
                  : "max-w-[85%] rounded-lg bg-slate-100 border border-slate-200 text-slate-900 px-3 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-600 flex items-center gap-2">
              <DashSpinner /> Thinking…
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask the agent…"
          rows={2}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm resize-none focus:border-[#185FA5] focus:outline-none"
        />
        {loading ? (
          <DashButton variant="danger" onClick={stop}>
            <span className="inline-flex items-center gap-2">
              <DashSpinner /> Stop
            </span>
          </DashButton>
        ) : (
          <DashButton type="submit" onClick={() => void send(input)} disabled={!input.trim()}>
            Send
          </DashButton>
        )}
      </form>

      {/* Tool transparency: show what Claude actually called on the last turn */}
      {lastSteps.length > 0 ? (
        <details className="mt-6">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
            Show tool calls from last response ({lastSteps.filter((s) => s.type === "tool_call").length})
          </summary>
          <div className="mt-3 space-y-2">
            {lastSteps
              .filter((s): s is Extract<Step, { type: "tool_call" }> => s.type === "tool_call")
              .map((s, i) => (
                <DashCard key={i} padding="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <DashPill tone="violet">{s.tool}</DashPill>
                  </div>
                  <details>
                    <summary className="text-[11px] text-slate-500 cursor-pointer">
                      input
                    </summary>
                    <pre className="mt-1 text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">
                      {JSON.stringify(s.input, null, 2)}
                    </pre>
                  </details>
                  <details>
                    <summary className="text-[11px] text-slate-500 cursor-pointer mt-1">
                      output (truncated)
                    </summary>
                    <pre className="mt-1 text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto max-h-60">
                      {JSON.stringify(s.output, null, 2).slice(0, 4000)}
                    </pre>
                  </details>
                </DashCard>
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
