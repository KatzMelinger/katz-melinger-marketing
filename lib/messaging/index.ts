/**
 * Outbound messaging — the single entry point.
 *
 * Callers do `dispatch('email' | 'sms', message)` and stay channel-agnostic.
 * Each channel has one adapter (Resend / Twilio); adapters stub cleanly when
 * their provider keys are absent, so features that send work end-to-end in dev
 * without any provisioning. `messagingStatus()` reports which channels are live
 * so the UI can warn that a send will be simulated.
 */

import { resendAdapter } from "./resend";
import { twilioAdapter } from "./twilio";
import type {
  MessagingAdapter,
  SendChannel,
  SendMessage,
  SendResult,
} from "./types";

export type {
  SendChannel,
  SendMessage,
  SendResult,
  SendStatus,
} from "./types";

const ADAPTERS: Record<SendChannel, MessagingAdapter> = {
  email: resendAdapter,
  sms: twilioAdapter,
};

/** Send a message through the given channel. Never throws — failures come back
 *  as `{ status: 'failed', error }` so callers can persist the outcome. */
export async function dispatch(
  channel: SendChannel,
  message: SendMessage,
): Promise<SendResult> {
  const adapter = ADAPTERS[channel];
  if (!adapter) {
    return {
      channel,
      status: "failed",
      provider: "none",
      id: null,
      error: `Unknown channel: ${channel}`,
    };
  }
  return adapter.send(message);
}

/** True when the channel's provider keys are configured (real sends happen). */
export function isChannelLive(channel: SendChannel): boolean {
  return ADAPTERS[channel]?.isLive() ?? false;
}

/** Per-channel live/stub status for surfacing in the UI. */
export function messagingStatus(): Record<
  SendChannel,
  { provider: string; live: boolean }
> {
  return {
    email: { provider: resendAdapter.provider, live: resendAdapter.isLive() },
    sms: { provider: twilioAdapter.provider, live: twilioAdapter.isLive() },
  };
}
