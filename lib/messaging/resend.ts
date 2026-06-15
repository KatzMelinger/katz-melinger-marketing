/**
 * Email adapter — Resend transactional API, called via fetch (no SDK dep).
 *
 * Configured by env:
 *   RESEND_API_KEY   — required to actually send; absent ⇒ adapter stubs.
 *   RESEND_FROM      — default From, e.g. "Katz Melinger <reviews@firm.com>".
 *
 * When the key is absent, send() returns a `stubbed` result so the whole
 * review-request flow runs end-to-end in dev without provisioning anything.
 */

import type { MessagingAdapter, SendMessage, SendResult } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal, link-safe HTML wrapper around the plain-text body. */
function toHtml(body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${paragraphs}</div>`;
}

export const resendAdapter: MessagingAdapter = {
  channel: "email",
  provider: "resend",

  isLive() {
    return Boolean(process.env.RESEND_API_KEY?.trim());
  },

  async send(message: SendMessage): Promise<SendResult> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = message.from ?? process.env.RESEND_FROM?.trim();

    if (!apiKey) {
      return {
        channel: "email",
        status: "stubbed",
        provider: "stub",
        id: null,
      };
    }
    if (!from) {
      return {
        channel: "email",
        status: "failed",
        provider: "resend",
        id: null,
        error: "RESEND_FROM is not set (need a verified sender address).",
      };
    }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject ?? "A quick favor",
          html: toHtml(message.body),
          text: message.body,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };

      if (!res.ok) {
        return {
          channel: "email",
          status: "failed",
          provider: "resend",
          id: null,
          error: payload.message ?? `Resend HTTP ${res.status}`,
        };
      }

      return {
        channel: "email",
        status: "sent",
        provider: "resend",
        id: payload.id ?? null,
      };
    } catch (e) {
      return {
        channel: "email",
        status: "failed",
        provider: "resend",
        id: null,
        error: e instanceof Error ? e.message : "Unknown Resend error",
      };
    }
  },
};
