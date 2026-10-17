import { TraceXClient } from '@tracex/core';
import { TraceXNodeOptions } from '../types';

/**
 * Listens for uncaught exceptions and unhandled promise rejections on the Node.js / Bun process,
 * capturing forensics, flushing the telemetry pipeline, and gracefully handling process termination.
 */
export class ServerRuntimeListener {
  private readonly client: TraceXClient;
  private readonly options: TraceXNodeOptions;
  private readonly exitFn: (code: number) => void;

  private uncaughtExceptionHandler?: (error: Error, origin: string) => Promise<void>;
  private unhandledRejectionHandler?: (reason: unknown, promise: Promise<unknown>) => Promise<void>;
  private isInstalled = false;

  constructor(client: TraceXClient, options: TraceXNodeOptions) {
    this.client = client;
    this.options = options;
    this.exitFn = options.exitFn || ((code = 1) => process.exit(code));
  }

  public install(): void {
    if (this.isInstalled) return;

    if (this.options.captureUncaughtExceptions !== false) {
      this.uncaughtExceptionHandler = async (error: Error, origin: string) => {
        try {
          this.client.captureException(error, {
            mechanism: 'uncaughtException',
            origin,
          });

          const timeout = this.options.uncaughtExceptionTimeoutMs ?? 2000;
          await this.client.flush(timeout);
        } catch (err) {
          if (this.options.debug) {
            console.warn('[TraceX] Failed to flush uncaughtException telemetry:', err);
          }
        } finally {
          if (this.options.exitOnUncaughtException !== false) {
            console.error('[TraceX] Fatal uncaughtException:', error);
            this.exitFn(1);
          }
        }
      };

      process.on('uncaughtException', this.uncaughtExceptionHandler);
    }

    if (this.options.captureUnhandledRejections !== false) {
      this.unhandledRejectionHandler = async (reason: unknown, _promise: Promise<unknown>) => {
        try {
          this.client.captureException(reason, {
            mechanism: 'unhandledRejection',
          });
        } catch (err) {
          if (this.options.debug) {
            console.warn('[TraceX] Failed to capture unhandledRejection telemetry:', err);
          }
        }
      };

      process.on('unhandledRejection', this.unhandledRejectionHandler);
    }

    this.isInstalled = true;
  }

  public uninstall(): void {
    if (!this.isInstalled) return;

    if (this.uncaughtExceptionHandler) {
      process.removeListener('uncaughtException', this.uncaughtExceptionHandler);
      this.uncaughtExceptionHandler = undefined;
    }

    if (this.unhandledRejectionHandler) {
      process.removeListener('unhandledRejection', this.unhandledRejectionHandler);
      this.unhandledRejectionHandler = undefined;
    }

    this.isInstalled = false;
  }
}
