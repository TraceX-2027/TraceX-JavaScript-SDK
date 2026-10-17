import { TraceXClient } from './client/tracex-client';
import { BreadcrumbInput, TraceXOptions } from './types';

/**
 * Static facade for TraceX client operations.
 */
export class TraceX {
  private static _instance: TraceXClient | undefined;

  /**
   * Initializes the global TraceX client singleton.
   * Throws Error if projectKey is missing or does not start with 'tracex_live_' or 'tracex_test_'.
   */
  public static init(options: TraceXOptions): TraceXClient {
    const client = new TraceXClient(options);
    TraceX._instance = client;
    return client;
  }

  /**
   * Returns the active global TraceX client singleton, or undefined if not initialized.
   */
  public static getClient(): TraceXClient | undefined {
    return TraceX._instance;
  }

  /**
   * Captures an unhandled exception or error using the active client singleton.
   * Completely non-blocking and safe if the client has not been initialized.
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
   * Closes the active client singleton and flushes pending events.
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
    TraceX._instance = undefined;
  }
}

// Export all types and core classes
export * from './types';
export * from './buffer/ring-buffer';
export * from './sanitizer/data-scrubber';
export * from './transport/http-dispatcher';
export * from './client/tracex-client';

export default TraceX;
