'use client';

import type {
  Breadcrumb,
  BreadcrumbInput,
  EnvironmentContext,
  CrashEventPayload,
  TransportResponse,
  ITransport,
  TraceXOptions,
  HttpDispatcherOptions,
} from '@tracex/core';
import {
  BreadcrumbRingBuffer,
  DataScrubber,
  HttpTelemetryDispatcher,
  DefaultFetchTransport,
  TraceXClient,
} from '@tracex/core';
import { TraceXReactClient } from './client/react-client';
import type {
  TraceXReactOptions,
  BrowserEnvironmentContext,
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState,
  FallbackProps,
  FallbackRender,
} from './types';

/**
 * Static facade for TraceX React & browser SDK.
 */
export class TraceX {
  private static _instance: TraceXReactClient | undefined;

  /**
   * Initializes the global TraceX React client singleton.
   */
  public static init(options: TraceXReactOptions): TraceXReactClient {
    const old = TraceX._instance;
    TraceX._instance = undefined;
    if (old) {
      old.close().catch(() => {});
    }
    const client = new TraceXReactClient(options);
    TraceX._instance = client;
    return client;
  }

  /**
   * Returns the active global TraceX React client singleton, or undefined if not initialized.
   */
  public static getClient(): TraceXReactClient | undefined {
    return TraceX._instance;
  }

  /**
   * Captures an unhandled exception or error using the active client singleton.
   * Dynamically enriches live browser forensics and viewport metrics.
   */
  public static captureException(
    error: unknown,
    context?: Record<string, unknown>
  ): string | undefined {
    return TraceX._instance?.captureException(error, context);
  }

  /**
   * Records a breadcrumb using the active client singleton.
   */
  public static addBreadcrumb(breadcrumb: BreadcrumbInput): void {
    TraceX._instance?.addBreadcrumb(breadcrumb);
  }

  /**
   * Awaits in-flight and queued telemetry events up to timeoutMs using the active client singleton.
   */
  public static async flush(timeoutMs?: number): Promise<boolean> {
    if (!TraceX._instance) {
      return true;
    }
    return TraceX._instance.flush(timeoutMs);
  }

  /**
   * Closes the active client singleton, restores patched globals, unregisters listeners,
   * and flushes pending events.
   */
  public static async close(timeoutMs?: number): Promise<boolean> {
    if (!TraceX._instance) {
      return true;
    }
    const result = await TraceX._instance.close(timeoutMs);
    TraceX._instance = undefined;
    return result;
  }

  /**
   * Resets the active singleton instance (primarily for isolated unit tests).
   */
  public static reset(): void {
    if (TraceX._instance) {
      TraceX._instance.close().catch(() => {});
      TraceX._instance = undefined;
    }
  }
}

// Top-level functional helpers
export const init = (options: TraceXReactOptions): TraceXReactClient => TraceX.init(options);
export const getClient = (): TraceXReactClient | undefined => TraceX.getClient();
export const captureException = (error: unknown, context?: Record<string, unknown>): string | undefined =>
  TraceX.captureException(error, context);
export const addBreadcrumb = (breadcrumb: BreadcrumbInput): void => TraceX.addBreadcrumb(breadcrumb);
export const flush = (timeoutMs?: number): Promise<boolean> => TraceX.flush(timeoutMs);
export const close = (timeoutMs?: number): Promise<boolean> => TraceX.close(timeoutMs);
export const reset = (): void => TraceX.reset();

// Re-export core types
export type {
  Breadcrumb,
  BreadcrumbInput,
  EnvironmentContext,
  CrashEventPayload,
  TransportResponse,
  ITransport,
  TraceXOptions,
  HttpDispatcherOptions,
};

// Re-export core primitives
export {
  BreadcrumbRingBuffer,
  DataScrubber,
  HttpTelemetryDispatcher,
  DefaultFetchTransport,
  TraceXClient,
};

// Export React types
export type {
  TraceXReactOptions,
  BrowserEnvironmentContext,
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState,
  FallbackProps,
  FallbackRender,
};

// Export React client
export { TraceXReactClient };

// Export browser integrations
export * from './integrations/environment';
export * from './integrations/error-listeners';
export * from './integrations/dom-tracker';
export * from './integrations/navigation-tracker';

// Export React components and context
export * from './components/error-boundary';
export * from './context/tracex-context';

export default TraceX;
