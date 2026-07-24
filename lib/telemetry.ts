/**
 * Minimal structured telemetry. Emits one JSON line per event so features can be
 * instrumented without a metrics backend yet; swap the sink here later without
 * touching call sites. Never throws — telemetry must not break a request.
 */
export function logEvent(name: string, payload: Record<string, unknown> = {}): void {
  try {
    console.info(`[telemetry] ${name} ${JSON.stringify(payload)}`);
  } catch {
    console.info(`[telemetry] ${name}`);
  }
}
