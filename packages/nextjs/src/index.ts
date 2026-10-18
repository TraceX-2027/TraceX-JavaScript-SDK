import type { BreadcrumbInput, TraceXClient } from '@tracex-dev/core';
import {
  TraceX as TraceXReact,
  type TraceXReactClient,
} from '@tracex-dev/react';
import {
  TraceXServer,
} from './server/tracex-server';
import type { TraceXNextOptions } from './types/index';

/**
 * Determines whether execution is occurring inside a client (browser) environment.
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Universal isomorphic static facade for TraceX Next.js SDK.
 * Dynamically routes calls to server or browser runtimes based on execution environment.
 */
export class TraceX {
  /**
   * Initializes TraceX client with environment-aware routing:
   * Uses TraceXReact in browser hydration and TraceXNode with Vercel forensics on server.
   */
  public static init(options: TraceXNextOptions): TraceXClient {
    if (isBrowser()) {
      return TraceXReact.init(options as any);
    }
    return TraceXServer.init(options);
  }

  /**
   * Returns active singleton instance across server or client contexts.
   */
  public static getClient(): TraceXClient | undefined {
    if (isBrowser()) {
      return TraceXReact.getClient() ?? TraceXServer.getClient();
    }
    return TraceXServer.getClient() ?? TraceXReact.getClient();
  }

  /**
   * Captures an unhandled exception or error using the active client singleton.
   */
  public static captureException(
    error: unknown,
    context?: Record<string, unknown>
  ): string | undefined {
    return TraceX.getClient()?.captureException(error, context);
  }

  /**
   * Records a user or system breadcrumb into the circular buffer.
   */
  public static addBreadcrumb(breadcrumb: BreadcrumbInput): void {
    TraceX.getClient()?.addBreadcrumb(breadcrumb);
  }

  /**
   * Awaits in-flight and queued telemetry events up to timeoutMs using active client.
   */
  public static async flush(timeoutMs?: number): Promise<boolean> {
    const client = TraceX.getClient();
    if (!client) {
      return true;
    }
    return client.flush(timeoutMs);
  }

  /**
   * Closes active client, restores listeners, and flushes pending events.
   */
  public static async close(timeoutMs?: number): Promise<boolean> {
    const serverResult = await TraceXServer.close(timeoutMs);
    const reactResult = await TraceXReact.close(timeoutMs);
    return serverResult && reactResult;
  }

  /**
   * Resets active singleton instances (primarily for isolated unit tests).
   */
  public static reset(): void {
    TraceXServer.reset();
    TraceXReact.reset();
  }
}

// Convenience top-level functional helpers
export const init = (options: TraceXNextOptions): TraceXClient =>
  TraceX.init(options);
export const getClient = (): TraceXClient | undefined => TraceX.getClient();
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): string | undefined => TraceX.captureException(error, context);
export const addBreadcrumb = (breadcrumb: BreadcrumbInput): void =>
  TraceX.addBreadcrumb(breadcrumb);
export const flush = (timeoutMs?: number): Promise<boolean> =>
  TraceX.flush(timeoutMs);
export const close = (timeoutMs?: number): Promise<boolean> =>
  TraceX.close(timeoutMs);
export const reset = (): void => TraceX.reset();

// Server exports
export { withTraceXServerAction } from './server/server-action';
export { withTraceXRoute } from './server/route-handler';
export { VercelEnvironmentProvider } from './server/environment';

// Client exports
export {
  TraceXClientProvider,
  DefaultErrorFallback,
} from './client/provider';
export { captureNextGlobalError } from './client/global-error';
export {
  TraceXProvider,
  TraceXErrorBoundary,
  withTraceXErrorBoundary,
  useTraceX,
  useCaptureException,
  useAddBreadcrumb,
} from '@tracex-dev/react';

// Re-export all types
export * from './types/index';

export default TraceX;
