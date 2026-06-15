/**
 * Channel-agnostic outbound messaging — shared types.
 *
 * The review-generation workflow (and any future outbound feature) sends
 * through `dispatch(channel, message)` and never imports a provider directly.
 * Adding a third channel = one new adapter + one switch arm.
 */

export type SendChannel = "email" | "sms";

export type SendMessage = {
  /** Email address (email channel) or E.164 phone number (sms channel). */
  to: string;
  /** Email subject. Ignored by SMS. */
  subject?: string;
  /** The message body. Plain text; the email adapter wraps it in minimal HTML. */
  body: string;
  /** Override the default From. Falls back to the channel's env-configured sender. */
  from?: string;
};

export type SendStatus =
  | "sent" // provider accepted the message
  | "stubbed" // no provider key configured — simulated, nothing actually sent
  | "failed"; // provider rejected the message

export type SendResult = {
  channel: SendChannel;
  status: SendStatus;
  /** Provider name: 'resend' | 'twilio' | 'stub'. */
  provider: string;
  /** Provider message id (or a synthetic id for stubs). */
  id: string | null;
  /** Populated when status === 'failed'. */
  error?: string;
};

/** A messaging adapter: one channel, one provider. */
export interface MessagingAdapter {
  readonly channel: SendChannel;
  readonly provider: string;
  /** True when the provider is configured (env keys present). */
  isLive(): boolean;
  send(message: SendMessage): Promise<SendResult>;
}
