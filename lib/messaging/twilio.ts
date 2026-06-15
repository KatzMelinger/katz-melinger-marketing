/**
 * SMS adapter — Twilio Messages API, called via fetch (no SDK dep).
 *
 * Configured by env:
 *   TWILIO_ACCOUNT_SID   — required to actually send; absent ⇒ adapter stubs.
 *   TWILIO_AUTH_TOKEN    — required to actually send.
 *   TWILIO_FROM          — sending number (E.164) or Messaging Service SID.
 *
 * NOTE: Twilio will not deliver A2P SMS to US numbers until the sending number
 * is registered under 10DLC. Start that registration in parallel — until it
 * clears, live sends are rejected by the carrier even with valid credentials.
 *
 * When the SID/token are absent, send() returns a `stubbed` result so the
 * review-request flow runs end-to-end in dev without provisioning anything.
 */

import type { MessagingAdapter, SendMessage, SendResult } from "./types";

export const twilioAdapter: MessagingAdapter = {
  channel: "sms",
  provider: "twilio",

  isLive() {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
        process.env.TWILIO_AUTH_TOKEN?.trim(),
    );
  },

  async send(message: SendMessage): Promise<SendResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = message.from ?? process.env.TWILIO_FROM?.trim();

    if (!sid || !token) {
      return {
        channel: "sms",
        status: "stubbed",
        provider: "stub",
        id: null,
      };
    }
    if (!from) {
      return {
        channel: "sms",
        status: "failed",
        provider: "twilio",
        id: null,
        error: "TWILIO_FROM is not set (sending number or Messaging Service SID).",
      };
    }

    try {
      // `from` is a Messaging Service SID (MG…) or a phone number — Twilio
      // accepts MessagingServiceSid for the former, From for the latter.
      const form = new URLSearchParams({ To: message.to, Body: message.body });
      if (from.startsWith("MG")) form.set("MessagingServiceSid", from);
      else form.set("From", from);

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            // Basic auth: base64("SID:TOKEN"). btoa is available in the
            // Next.js runtimes (Node 18+ / edge).
            Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        },
      );

      const payload = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
      };

      if (!res.ok) {
        return {
          channel: "sms",
          status: "failed",
          provider: "twilio",
          id: null,
          error: payload.message ?? `Twilio HTTP ${res.status}`,
        };
      }

      return {
        channel: "sms",
        status: "sent",
        provider: "twilio",
        id: payload.sid ?? null,
      };
    } catch (e) {
      return {
        channel: "sms",
        status: "failed",
        provider: "twilio",
        id: null,
        error: e instanceof Error ? e.message : "Unknown Twilio error",
      };
    }
  },
};
