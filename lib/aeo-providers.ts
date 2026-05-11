/**
 * Multi-provider abstraction for the AEO (Answer Engine Optimization) feature.
 *
 * For each enabled provider we run the same prompt and capture:
 *   - the raw answer text
 *   - any citations the provider attached (Perplexity, OpenAI web search,
 *     Gemini grounding) — falling back to URL extraction from the body
 *   - the model snapshot used and the round-trip latency
 *
 * Each provider self-reports availability based on its API key. Providers with
 * no key set are skipped at runtime; the UI shows them greyed out so the user
 * knows what's missing.
 *
 * Day 1 — only Claude works out of the box (ANTHROPIC_API_KEY already present
 * for keyword research). Adding any of OPENAI_API_KEY, PERPLEXITY_API_KEY,
 * GEMINI_API_KEY enables the corresponding provider with no code change.
 */

import { getAnthropic } from "./anthropic";
import { logger } from "./logger";

export type AEOProviderId = "claude" | "openai" | "perplexity" | "gemini";

export type AEOCitation = {
  url: string;
  domain: string;
  title?: string;
};

export type AEOProviderResponse = {
  provider: AEOProviderId;
  model: string;
  text: string;
  citations: AEOCitation[];
  latencyMs: number;
};

export type AEOProvider = {
  id: AEOProviderId;
  label: string;
  isAvailable(): boolean;
  /** Display-only model id; real call may resolve a snapshot. */
  defaultModel: string;
  ask(prompt: string): Promise<AEOProviderResponse>;
};

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const URL_REGEX = /https?:\/\/[^\s)>\]'"`]+/g;

export function extractCitationsFromText(text: string): AEOCitation[] {
  const seen = new Set<string>();
  const out: AEOCitation[] = [];
  for (const raw of text.matchAll(URL_REGEX)) {
    const url = raw[0].replace(/[.,;)\]'"`>]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const u = new URL(url);
      out.push({ url, domain: u.host.replace(/^www\./, "") });
    } catch {
      // skip invalid
    }
  }
  return out;
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

const claudeProvider: AEOProvider = {
  id: "claude",
  label: "Claude",
  defaultModel: CLAUDE_MODEL,
  isAvailable: () => Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  async ask(prompt: string) {
    const started = Date.now();
    const response = await getAnthropic().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system:
        "You are a helpful assistant answering buyer-intent questions. " +
        "Always name 1–5 specific organizations or law firms when asked for " +
        "recommendations, and include a brief reason for each. " +
        "When you reference an organization, include the URL of its primary " +
        "website if you know it.",
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    return {
      provider: "claude",
      model: CLAUDE_MODEL,
      text,
      citations: extractCitationsFromText(text),
      latencyMs: Date.now() - started,
    };
  },
};

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions, with web_search tool when available)
// ---------------------------------------------------------------------------

const OPENAI_MODEL = "gpt-4o-mini";

const openaiProvider: AEOProvider = {
  id: "openai",
  label: "ChatGPT",
  defaultModel: OPENAI_MODEL,
  isAvailable: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
  async ask(prompt: string) {
    const started = Date.now();
    const apiKey = process.env.OPENAI_API_KEY!;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. When asked for recommendations, " +
              "name 1–5 specific organizations or firms with a one-line " +
              "reason and the URL of their primary website if known.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      throw new Error(`OpenAI: ${res.status} ${res.statusText} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      provider: "openai",
      model: OPENAI_MODEL,
      text,
      citations: extractCitationsFromText(text),
      latencyMs: Date.now() - started,
    };
  },
};

// ---------------------------------------------------------------------------
// Perplexity (returns explicit citations in the response shape)
// ---------------------------------------------------------------------------

const PERPLEXITY_MODEL = "sonar";

const perplexityProvider: AEOProvider = {
  id: "perplexity",
  label: "Perplexity",
  defaultModel: PERPLEXITY_MODEL,
  isAvailable: () => Boolean(process.env.PERPLEXITY_API_KEY?.trim()),
  async ask(prompt: string) {
    const started = Date.now();
    const apiKey = process.env.PERPLEXITY_API_KEY!;
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          { role: "system", content: "Be precise. Cite sources." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      throw new Error(`Perplexity: ${res.status} ${res.statusText} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      citations?: string[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const explicit: AEOCitation[] = (data.citations ?? [])
      .map((url) => {
        const d = domainOf(url);
        return d ? { url, domain: d } : null;
      })
      .filter((c): c is AEOCitation => c !== null);
    const merged = explicit.length > 0 ? explicit : extractCitationsFromText(text);
    return {
      provider: "perplexity",
      model: PERPLEXITY_MODEL,
      text,
      citations: merged,
      latencyMs: Date.now() - started,
    };
  },
};

// ---------------------------------------------------------------------------
// Gemini (uses google-search grounding when available)
// ---------------------------------------------------------------------------
//
// We try a chain of models. 2.5-flash is the default, but it gets overloaded
// during peak hours (503 "high demand"). When that happens we drop back to
// 1.5-flash which has way more headroom. This gives us answers during spikes
// instead of dead rows in the AEO dashboard.

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"] as const;
const GEMINI_MODEL = GEMINI_MODELS[0];

async function callGemini(model: string, prompt: string, apiKey: string): Promise<Response> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    systemInstruction: {
      parts: [
        {
          text:
            "You are a helpful assistant. When asked for recommendations, " +
            "name specific organizations or firms with the URL of their " +
            "primary website.",
        },
      ],
    },
  });
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(45_000),
  });
}

const geminiProvider: AEOProvider = {
  id: "gemini",
  label: "Gemini",
  defaultModel: GEMINI_MODEL,
  isAvailable: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
  async ask(prompt: string) {
    const started = Date.now();
    const apiKey = process.env.GEMINI_API_KEY!;

    let res: Response | null = null;
    let modelUsed: string = GEMINI_MODEL;
    for (const model of GEMINI_MODELS) {
      // Up to 2 attempts on each model — one immediate, one after a 2s backoff
      // — before moving on to the next model in the fallback chain.
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await callGemini(model, prompt, apiKey);
        modelUsed = model;
        if (res.ok) break;
        if (attempt === 0 && (res.status === 429 || res.status === 503)) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        break;
      }
      if (res && res.ok) break;
      // Only fall through to next model on overload-type errors.
      if (res && res.status !== 429 && res.status !== 503) break;
    }

    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      const body = res ? await res.text() : "no response";
      throw new Error(`Gemini ${status} (${modelUsed}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
        groundingMetadata?: {
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
        };
      }[];
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
    }
    const cand = data.candidates?.[0];
    if (!cand) {
      throw new Error("Gemini returned no candidates");
    }
    const text = cand.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim() && cand.finishReason && cand.finishReason !== "STOP") {
      throw new Error(`Gemini finished without text (reason: ${cand.finishReason})`);
    }
    const grounding = cand.groundingMetadata?.groundingChunks ?? [];
    const explicit: AEOCitation[] = grounding
      .map((g): AEOCitation | null => {
        if (!g.web?.uri) return null;
        const d = domainOf(g.web.uri);
        if (!d) return null;
        const out: AEOCitation = { url: g.web.uri, domain: d };
        if (g.web.title) out.title = g.web.title;
        return out;
      })
      .filter((c): c is AEOCitation => c !== null);
    const merged = explicit.length > 0 ? explicit : extractCitationsFromText(text);
    return {
      provider: "gemini",
      model: modelUsed,
      text,
      citations: merged,
      latencyMs: Date.now() - started,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry + dispatcher
// ---------------------------------------------------------------------------

export const ALL_PROVIDERS: AEOProvider[] = [
  claudeProvider,
  openaiProvider,
  perplexityProvider,
  geminiProvider,
];

export function getAvailableProviders(): AEOProvider[] {
  return ALL_PROVIDERS.filter((p) => p.isAvailable());
}

export function getProvider(id: AEOProviderId): AEOProvider | null {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Run a single prompt against a provider, swallowing errors into a structured
 * shape so a single provider failure doesn't sink the whole sweep.
 */
export async function safeAsk(
  provider: AEOProvider,
  prompt: string,
): Promise<{ ok: true; response: AEOProviderResponse } | { ok: false; error: string }> {
  try {
    const response = await provider.ask(prompt);
    return { ok: true, response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ provider: provider.id, error: msg }, "AEO provider failed");
    return { ok: false, error: msg };
  }
}
