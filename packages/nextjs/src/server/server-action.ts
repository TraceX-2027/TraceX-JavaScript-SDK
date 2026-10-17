import { DataScrubber } from '@tracex/core';
import { TraceX } from './tracex-server';

function isFormData(val: unknown): val is FormData {
  return (
    (typeof FormData !== 'undefined' && val instanceof FormData) ||
    (val !== null &&
      typeof val === 'object' &&
      typeof (val as any).get === 'function' &&
      typeof (val as any).entries === 'function')
  );
}

function isNextControlFlowError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return error === 'NEXT_REDIRECT' || error === 'NEXT_NOT_FOUND';
  }
  const err = error as { digest?: unknown; message?: unknown };
  const digest = typeof err.digest === 'string' ? err.digest : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;

  return Boolean(
    (digest &&
      (digest.startsWith('NEXT_REDIRECT') ||
        digest.startsWith('NEXT_NOT_FOUND') ||
        digest === 'NEXT_NOT_FOUND')) ||
      (message && (message === 'NEXT_REDIRECT' || message === 'NEXT_NOT_FOUND'))
  );
}

function scrubActionArguments(args: unknown[], scrubber: DataScrubber): unknown[] {
  return args.map((arg) => {
    if (isFormData(arg)) {
      const record: Record<string, unknown> = {};
      try {
        for (const [key, value] of (arg as any).entries()) {
          const val =
            typeof value === 'object' && value !== null && 'name' in value
              ? `[File: ${String((value as any).name)}]`
              : value;

          if (key in record) {
            const existing = record[key];
            record[key] = Array.isArray(existing) ? [...existing, val] : [existing, val];
          } else {
            record[key] = val;
          }
        }
        return scrubber.scrub(record);
      } catch {
        return '[FormData]';
      }
    }
    return scrubber.scrub(arg);
  });
}

/**
 * Wraps a Next.js Server Action with execution duration tracking,
 * PII argument scrubbing, automatic crash telemetry capture, and fast queue flushing.
 *
 * Always rethrows the original exception to preserve Next.js Server Action lifecycles.
 */
export function withTraceXServerAction<TArgs extends any[], TReturn>(
  actionName: string,
  fn: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  const scrubber = new DataScrubber();

  return async (...args: TArgs): Promise<TReturn> => {
    const startTime = Date.now();
    try {
      const result = await fn(...args);
      const durationMs = Date.now() - startTime;

      try {
        TraceX.addBreadcrumb({
          category: 'action.server',
          action: actionName,
          target: actionName,
          data: {
            action_name: actionName,
            duration_ms: durationMs,
          },
        });
      } catch {
        // Breadcrumb emission must never crash the action
      }

      return result;
    } catch (error) {
      if (isNextControlFlowError(error)) {
        throw error;
      }

      const durationMs = Date.now() - startTime;

      try {
        const scrubbedArgs = scrubActionArguments(args, scrubber);

        TraceX.addBreadcrumb({
          category: 'action.server',
          action: actionName,
          target: actionName,
          data: {
            action_name: actionName,
            duration_ms: durationMs,
            status: 'error',
          },
        });

        TraceX.captureException(error, {
          mechanism: 'nextjs.server_action',
          action_name: actionName,
          duration_ms: durationMs,
          arguments: scrubbedArgs,
          args: scrubbedArgs,
        });

        await TraceX.flush(2000);
      } catch {
        // Telemetry errors must never suppress or replace the original error
      }

      throw error;
    }
  };
}
