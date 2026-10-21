/**
 * Start Improve to Ready on a new draft, refresh or Redraft without holding up
 * the request that created it (Oct 20 spec, Task A9: "runs automatically on
 * every new draft, refresh and Redraft"). The improve route has its own
 * five-minute budget; this only sends the request. Needs CRON_SECRET (the
 * proxy lets that bearer through); without it, the button still works.
 */
export async function requestImproveToReady(origin: string, draftId: string): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !draftId) return;
  try {
    await fetch(`${origin}/api/content/drafts/${draftId}/improve`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      // The improve run continues server-side; this request only starts it.
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // A timeout here is expected: the run keeps going in its own invocation.
  }
}
