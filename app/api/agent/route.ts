/**
 * POST /api/agent
 *   body: { messages: Array<{ role: 'user'|'assistant', content: string }> }
 *
 * Runs a tool-use loop with Claude:
 *   1. Send the conversation + TOOLS to Claude.
 *   2. If Claude returns tool_use blocks, dispatch each via lib/agent-tools.
 *   3. Append tool_result blocks and call Claude again.
 *   4. Repeat until end_turn or MAX_ITERATIONS.
 *
 * Returns the full transcript (assistant turns + tool calls + final text)
 * so the UI can render each step.
 */

import { NextRequest, NextResponse } from "next/server";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

import {
  cachedSystemPrompt,
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
} from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { dispatchTool, TOOLS } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ITERATIONS = 8;

type IncomingMessage = { role?: unknown; content?: unknown };
type StepLog =
  | { type: "assistant_text"; text: string }
  | {
      type: "tool_call";
      tool: string;
      input: unknown;
      output: unknown;
    };

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    messages?: IncomingMessage[];
  };
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // Normalize incoming history into Anthropic's MessageParam shape (strings
  // become a single text block — simpler than letting the client send blocks).
  const messages: MessageParam[] = incoming
    .map((m): MessageParam | null => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const text = asString(m.content).trim();
      if (!text) return null;
      return { role, content: [{ type: "text", text }] };
    })
    .filter((m): m is MessageParam => m !== null);

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "no non-empty messages" },
      { status: 400 },
    );
  }

  const firm = await getFirmContext();
  const today = new Date().toISOString().slice(0, 10);
  const system = `You are Agent Assistant — an AI assistant inside Katz Melinger's MarketOS dashboard. ${firm}

Today is ${today}. You help the marketing team plan, execute, and review work across SEO, AEO, content, and on-page fixes. You have access to live tools that read from the firm's data and call into the dashboard's intelligence endpoints.

When the user asks something answerable by a tool, use the tool — don't just guess. After tool results come back, summarize what you found in a way that's directly useful to a marketer (cite specific items, urgencies, rank changes, etc., rather than restating the JSON). When no tool fits, answer from your own reasoning with clear caveats.

Keep responses focused. Default to short, scannable bullets unless the user asks for prose.`;

  const anthropic = getAnthropic();
  const steps: StepLog[] = [];
  let finalText = "";
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    // The user hit "Stop" (or the connection dropped) — bail with partial work.
    if (req.signal.aborted) break;
    iterations += 1;
    let resp;
    try {
      resp = await anthropic.messages.create(
        {
          model: KEYWORD_RESEARCH_MODEL,
          max_tokens: 2048,
          system: cachedSystemPrompt(system),
          tools: TOOLS,
          messages,
        },
        // Propagate the abort so the in-flight request to Anthropic is cancelled
        // immediately, not just at the next loop boundary.
        { signal: req.signal },
      );
    } catch (err) {
      if (req.signal.aborted) break;
      throw err;
    }

    // Capture any assistant text + tool_use blocks from this turn.
    const assistantBlocks = resp.content;
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
    for (const block of assistantBlocks) {
      if (block.type === "text" && block.text.trim()) {
        steps.push({ type: "assistant_text", text: block.text });
        finalText = block.text;
      }
      if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    // If the model didn't ask for any tools this turn, we're done.
    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      messages.push({ role: "assistant", content: assistantBlocks });
      break;
    }

    // Run each tool and collect tool_result blocks.
    messages.push({ role: "assistant", content: assistantBlocks });
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];
    for (const tu of toolUses) {
      let output: unknown;
      try {
        output = await dispatchTool(
          tu.name,
          (tu.input ?? {}) as Record<string, unknown>,
          req,
        );
      } catch (err) {
        output = { error: err instanceof Error ? err.message : "tool error" };
      }
      steps.push({
        type: "tool_call",
        tool: tu.name,
        input: tu.input,
        output,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(output).slice(0, 50_000),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({
    text: finalText,
    steps,
    iterations,
    hitLimit: iterations >= MAX_ITERATIONS,
    aborted: req.signal.aborted,
  });
}
