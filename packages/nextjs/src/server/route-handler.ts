import { DataScrubber } from '@tracex/core';
import type { RouteHandler, TraceXRouteOptions } from '../types/index';
import { TraceX } from './tracex-server';

function createProblemResponse(body: Record<string, unknown>): Response {
  if (typeof Response !== 'undefined' && typeof Response.json === 'function') {
    return Response.json(body, {
      status: 500,
      headers: {
        'Content-Type': 'application/problem+json',
      },
    });
  }

  return new Response(JSON.stringify(body), {
    status: 500,
    headers: {
      'Content-Type': 'application/problem+json',
    },
  });
}

function generateFallbackEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `evt_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 11)}`;
}

function isNextControlFlowError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return (
      error === 'NEXT_REDIRECT' ||
      error === 'NEXT_NOT_FOUND' ||
      error === 'DYNAMIC_SERVER_USAGE' ||
      error.startsWith('DYNAMIC_SERVER_USAGE')
    );
  }
  const err = error as { digest?: unknown; message?: unknown };
  const digest = typeof err.digest === 'string' ? err.digest : undefined;
  const message = typeof err.message === 'string' ? err.message : undefined;

  return Boolean(
    (digest &&
      (digest.startsWith('NEXT_REDIRECT') ||
        digest.startsWith('NEXT_NOT_FOUND') ||
        digest === 'NEXT_NOT_FOUND' ||
        digest.startsWith('DYNAMIC_SERVER_USAGE') ||
        digest === 'DYNAMIC_SERVER_USAGE')) ||
      (message &&
        (message === 'NEXT_REDIRECT' ||
          message === 'NEXT_NOT_FOUND' ||
          message === 'DYNAMIC_SERVER_USAGE' ||
          message.includes('Dynamic server usage')))
  );
}

/**
 * Wraps Next.js App Router Route Handlers (`app/api/**\/route.ts`) with
 * automatic unhandled exception capture, RFC 7807 problem details response formatting,
 * and optional error rethrowing.
 */
export function withTraceXRoute<TContext = any>(
  handler: RouteHandler<TContext>,
  options?: TraceXRouteOptions
): (request: Request, context?: TContext) => Promise<Response> {
  const scrubber = new DataScrubber();

  return async (request: Request, context?: TContext): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (isNextControlFlowError(error)) {
        throw error;
      }

      let eventId: string | undefined;

      try {
        let params: unknown = undefined;
        if (context && typeof context === 'object' && 'params' in (context as any)) {
          params = (context as any).params;
          if (params && typeof (params as any).then === 'function') {
            try {
              params = await params;
            } catch {
              params = undefined;
            }
          }
        }

        const scrubbedUrl = request?.url ? scrubber.scrubString(request.url) : undefined;
        const scrubbedParams = params !== undefined ? scrubber.scrub(params) : undefined;
        const method = request?.method;

        eventId = TraceX.captureException(error, {
          mechanism: 'nextjs.route_handler',
          url: scrubbedUrl,
          method,
          params: scrubbedParams,
        });

        await TraceX.flush(2000);
      } catch {
        // Telemetry errors must never prevent response generation or rethrow
      }

      if (options?.rethrow) {
        throw error;
      }

      const traceId = eventId || generateFallbackEventId();

      return createProblemResponse({
        type: 'https://tracex.dev/errors/internal-server-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unhandled server error occurred while processing the request.',
        trace_id: traceId,
      });
    }
  };
}
