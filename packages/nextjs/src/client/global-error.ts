import { TraceX } from '@tracex/react';

function generateFallbackEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `evt_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Captures unhandled errors in Next.js root layout boundary (`app/global-error.tsx`).
 * Extracts Next.js error digest, enriches telemetry with `mechanism: 'nextjs.global_error'`,
 * flushes in-flight events, and returns the generated TraceX eventId string.
 */
export async function captureNextGlobalError(
  error: unknown,
  context?: Record<string, unknown>
): Promise<string> {
  const digest =
    error && typeof error === 'object' && 'digest' in error && (error as any).digest != null
      ? String((error as any).digest)
      : undefined;

  const errorContext: Record<string, unknown> = {
    mechanism: 'nextjs.global_error',
    ...(digest ? { digest } : {}),
    ...(context || {}),
  };

  let eventId = TraceX.captureException(error, errorContext);

  if (!eventId) {
    eventId = generateFallbackEventId();
  }

  try {
    await TraceX.flush(2000);
  } catch {
    // Non-blocking flush
  }

  return eventId;
}
