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
import { TraceXNodeClient } from './client/node-client';
import type { TraceXNodeOptions, ServerEnvironmentContext } from './types';

/**
 * Static facade for TraceX Node.js & Bun SDK.
 */
export class TraceX {
  private static _instance: TraceXNodeClient | undefined;

  /**
   * Initializes the global TraceX Node client singleton.
   */
  public static init(options: TraceXNodeOptions): TraceXNodeClient {
    const old = TraceX._instance;
    TraceX._instance = undefined;
    if (old) {
      old.close().catch(() => {});
    }
    const client = new TraceXNodeClient(options);
    TraceX._instance = client;
    return client;
  }

  /**
   * Returns the active global TraceX Node client singleton, or undefined if not initialized.
   */
  public static getClient(): TraceXNodeClient | undefined {
    return TraceX._instance;
  }

  /**
   * Captures an unhandled exception or error using the active client singleton.
   * Dynamically enriches live server forensics and memory metrics.
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
      TraceX._instance.close();
      TraceX._instance = undefined;
    }
  }
}

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

// Export Node-specific types and components
export type { TraceXNodeOptions, ServerEnvironmentContext };
export { TraceXNodeClient };
export * from './integrations/environment';
export * from './integrations/http-instrumentation';
export * from './integrations/error-listeners';
export * from './integrations/lifecycle';

export default TraceX;
