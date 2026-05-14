/**
 * AI bot user-agent detection.
 *
 * Used by /api/ai-bots/ingest to canonicalize incoming UA strings into a
 * stable bot name. Matches strings from the public bot directories
 * maintained by each provider (OpenAI, Anthropic, Perplexity, Google,
 * Microsoft, etc.) as of Q1 2026.
 *
 * Sources:
 *   - OpenAI:    https://platform.openai.com/docs/bots
 *   - Anthropic: https://docs.anthropic.com/en/docs/agents-and-tools/claude-bot
 *   - Google:    https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
 *   - Perplexity: https://docs.perplexity.ai/docs/perplexitybot
 *   - Microsoft: https://learn.microsoft.com/en-us/bingbot
 *   - You.com:    https://about.you.com/youbot
 */

export type DetectedBot = {
  bot: string;
  vendor: string;
  purpose: "crawl_for_training" | "answer_lookup" | "indexing" | "unknown";
};

const PATTERNS: Array<{ re: RegExp; bot: string; vendor: string; purpose: DetectedBot["purpose"] }> = [
  // OpenAI
  { re: /GPTBot/i, bot: "gptbot", vendor: "OpenAI", purpose: "crawl_for_training" },
  { re: /ChatGPT-User/i, bot: "chatgpt-user", vendor: "OpenAI", purpose: "answer_lookup" },
  { re: /OAI-SearchBot/i, bot: "oai-searchbot", vendor: "OpenAI", purpose: "indexing" },

  // Anthropic
  { re: /ClaudeBot/i, bot: "claudebot", vendor: "Anthropic", purpose: "crawl_for_training" },
  { re: /Claude-Web/i, bot: "claude-web", vendor: "Anthropic", purpose: "answer_lookup" },
  { re: /anthropic-ai/i, bot: "anthropic-ai", vendor: "Anthropic", purpose: "crawl_for_training" },

  // Perplexity
  { re: /PerplexityBot/i, bot: "perplexitybot", vendor: "Perplexity", purpose: "indexing" },
  { re: /Perplexity-User/i, bot: "perplexity-user", vendor: "Perplexity", purpose: "answer_lookup" },

  // Google AI
  { re: /Google-Extended/i, bot: "google-extended", vendor: "Google", purpose: "crawl_for_training" },
  { re: /Bard-Google/i, bot: "bard-google", vendor: "Google", purpose: "answer_lookup" },

  // Microsoft
  { re: /Bingbot.*Microsoft Bing/i, bot: "bingbot", vendor: "Microsoft", purpose: "indexing" },
  { re: /CCBot/i, bot: "ccbot", vendor: "Common Crawl", purpose: "crawl_for_training" },

  // Others
  { re: /YouBot/i, bot: "youbot", vendor: "You.com", purpose: "indexing" },
  { re: /Bytespider/i, bot: "bytespider", vendor: "ByteDance", purpose: "crawl_for_training" },
  { re: /Diffbot/i, bot: "diffbot", vendor: "Diffbot", purpose: "indexing" },
  { re: /Amazonbot/i, bot: "amazonbot", vendor: "Amazon", purpose: "crawl_for_training" },
  { re: /AppleBot/i, bot: "applebot", vendor: "Apple", purpose: "indexing" },
];

export function detectAiBot(userAgent: string | null | undefined): DetectedBot | null {
  if (!userAgent) return null;
  for (const p of PATTERNS) {
    if (p.re.test(userAgent)) {
      return { bot: p.bot, vendor: p.vendor, purpose: p.purpose };
    }
  }
  return null;
}

export const KNOWN_AI_BOTS = PATTERNS.map((p) => ({
  bot: p.bot,
  vendor: p.vendor,
  purpose: p.purpose,
}));
