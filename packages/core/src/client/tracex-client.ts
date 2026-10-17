import { BreadcrumbRingBuffer } from '../buffer/ring-buffer';
import { DataScrubber } from '../sanitizer/data-scrubber';
import { HttpTelemetryDispatcher } from '../transport/http-dispatcher';
import {
  Breadcrumb,
  BreadcrumbInput,
  CrashEventPayload,
  EnvironmentContext,
  TraceXOptions,
} from '../types';

/**
 * Main TraceX client engine orchestrating breadcrumb buffering, PII scrubbing,
 * error normalization, and non-blocking telemetry ingestion.
 */
export class TraceXClient {
  private readonly options: TraceXOptions;
  private readonly ringBuffer: BreadcrumbRingBuffer;
  private readonly scrubber: DataScrubber;
  private readonly dispatcher: HttpTelemetryDispatcher;
  private readonly pendingHooks: Set<Promise<unknown>> = new Set();

  constructor(options: TraceXOptions) {
    if (!options || typeof options.projectKey !== 'string' || !options.projectKey) {
      throw new Error("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    }

    if (
      !options.projectKey.startsWith('tracex_live_') &&
      !options.projectKey.startsWith('tracex_test_')
    ) {
      throw new Error("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    }

    this.options = { ...options };
    this.ringBuffer = new BreadcrumbRingBuffer(options.maxBreadcrumbs ?? 50);
    this.scrubber = new DataScrubber();
    this.dispatcher = new HttpTelemetryDispatcher({
      endpoint: options.endpoint,
      projectKey: options.projectKey,
      transport: options.transport,
      debug: options.debug,
    });
  }

  /**
   * Returns a read-only copy of the client configuration options.
   */
  public getOptions(): Readonly<TraceXOptions> {
    return this.options;
  }

  /**
   * Returns the internal breadcrumb ring buffer.
   */
  public getRingBuffer(): BreadcrumbRingBuffer {
    return this.ringBuffer;
  }

  /**
   * Returns the data scrubber used for PII redaction.
   */
  public getScrubber(): DataScrubber {
    return this.scrubber;
  }

  /**
   * Returns the telemetry dispatcher.
   */
  public getDispatcher(): HttpTelemetryDispatcher {
    return this.dispatcher;
  }

  /**
   * Records a user/system action breadcrumb into the circular ring buffer.
   * Silently sanitizes sensitive data and never throws.
   */
  public addBreadcrumb(breadcrumb: BreadcrumbInput): void {
    try {
      const scrubbed = this.scrubber.scrubBreadcrumb(breadcrumb);
      this.ringBuffer.add(scrubbed);
    } catch (err) {
      if (this.options.debug) {
        console.warn('[TraceX] Failed to record breadcrumb:', err);
      }
    }
  }

  /**
   * Captures an unhandled exception or custom error and enqueues it for telemetry ingestion.
   * Completely non-blocking and safe against unexpected throwables.
   */
  public captureException(error: unknown, context?: Record<string, unknown>): string | undefined {
    try {
      let exceptionType = 'UnhandledException';
      let errorMessage = '';
      let stackTrace = '';

      if (error instanceof Error) {
        exceptionType = error.name || 'Error';
        errorMessage = error.message || String(error);
        stackTrace = error.stack || '';
      } else if (typeof error === 'string') {
        exceptionType = 'UnhandledException';
        errorMessage = error;
        stackTrace = new Error(error).stack || '';
      } else if (error && typeof error === 'object') {
        exceptionType = (error as { name?: string }).name || 'UnhandledException';
        let msg = (error as { message?: string }).message;
        if (!msg) {
          try {
            msg = JSON.stringify(error);
          } catch {
            msg = String(error);
          }
        }
        errorMessage = msg || 'UnhandledException';
        stackTrace = (error as { stack?: string }).stack || new Error(errorMessage).stack || '';
      } else {
        errorMessage = String(error);
        stackTrace = new Error(errorMessage).stack || '';
      }

      // Generate unique event identifier
      const eventId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? `evt_${crypto.randomUUID().replace(/-/g, '')}`
          : `evt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 11)}`;

      // Format environment context
      const envContext: EnvironmentContext =
        typeof this.options.environment === 'object' && this.options.environment !== null
          ? { ...this.options.environment }
          : {
              environment_name:
                typeof this.options.environment === 'string'
                  ? this.options.environment
                  : 'development',
            };

      if (this.options.release && !envContext.app_version) {
        envContext.app_version = this.options.release;
      }

      // Merge ad-hoc context
      if (context) {
        Object.assign(envContext, context);
      }

      // Build payload adhering to TraceX API Specification Section 3.1
      const rawPayload: CrashEventPayload = {
        event_id: eventId,
        project_key: this.options.projectKey,
        occurred_at: new Date().toISOString(),
        platform: this.options.platform || 'javascript',
        language: this.options.language || 'javascript',
        exception_type: exceptionType,
        error_message: errorMessage,
        stack_trace: stackTrace,
        environment: envContext,
        breadcrumbs: this.ringBuffer.getItems(),
      };

      // Scrub payload for PII, credentials, cards, and file paths
      const scrubbedPayload = this.scrubber.scrubPayload(rawPayload);

      // Execute beforeSend hook if defined
      if (this.options.beforeSend) {
        const hookResult = this.options.beforeSend(scrubbedPayload);
        if (hookResult === null || hookResult === undefined) {
          return undefined;
        }

        if (hookResult && typeof (hookResult as Promise<CrashEventPayload | null | undefined>).then === 'function') {
          const hookPromise = (hookResult as Promise<CrashEventPayload | null | undefined>)
            .then((asyncPayload) => {
              if (asyncPayload !== null && asyncPayload !== undefined) {
                this.dispatcher.enqueue(asyncPayload);
              }
            })
            .catch((err) => {
              if (this.options.debug) {
                console.warn('[TraceX] beforeSend failed:', err);
              }
            })
            .finally(() => {
              this.pendingHooks.delete(hookPromise);
            });

          this.pendingHooks.add(hookPromise);
          return eventId;
        }

        this.dispatcher.enqueue(hookResult as CrashEventPayload);
        return eventId;
      }

      this.dispatcher.enqueue(scrubbedPayload);
      return eventId;
    } catch (err) {
      if (this.options.debug) {
        console.warn('[TraceX] Failed to capture exception:', err);
      }
      return undefined;
    }
  }

  /**
   * Flushes in-flight and queued telemetry events up to the specified timeout in milliseconds.
   */
  public async flush(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    if (this.pendingHooks.size > 0) {
      await Promise.allSettled(Array.from(this.pendingHooks));
    }
    const elapsed = Date.now() - startTime;
    return this.dispatcher.flush(Math.max(0, timeoutMs - elapsed));
  }

  /**
   * Flushes telemetry and gracefully shuts down the client.
   */
  public async close(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    if (this.pendingHooks.size > 0) {
      await Promise.allSettled(Array.from(this.pendingHooks));
    }
    const elapsed = Date.now() - startTime;
    return this.dispatcher.close(Math.max(0, timeoutMs - elapsed));
  }
}
