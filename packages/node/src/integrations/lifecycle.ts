import { TraceXClient } from '@tracex-dev/core';

/**
 * Manages Node.js process lifecycle hooks, ensuring pending telemetry is flushed
 * before the process event loop terminates or when termination signals are received.
 */
export class ProcessLifecycleManager {
  private readonly client: TraceXClient;
  private readonly hookSignals: boolean;
  private readonly beforeExitHandler: (code: number) => Promise<void>;
  private sigtermHandler?: () => Promise<void>;
  private sigintHandler?: () => Promise<void>;
  private isInstalled = false;
  private hasFlushed = false;

  constructor(client: TraceXClient, options?: { hookSignals?: boolean }) {
    this.client = client;
    this.hookSignals = Boolean(options?.hookSignals);

    this.beforeExitHandler = async (_code: number) => {
      if (this.hasFlushed) return;
      this.hasFlushed = true;
      try {
        await this.client.flush();
      } catch {
        // Suppress any shutdown flush failure to allow clean process termination
      }
    };

    if (this.hookSignals) {
      this.sigtermHandler = async () => {
        try {
          await this.client.flush();
        } catch {
          // Suppress signal flush errors
        }
      };

      this.sigintHandler = async () => {
        try {
          await this.client.flush();
        } catch {
          // Suppress signal flush errors
        }
      };
    }
  }

  public install(): void {
    if (this.isInstalled) return;

    process.on('beforeExit', this.beforeExitHandler);

    if (this.sigtermHandler) {
      process.on('SIGTERM', this.sigtermHandler);
    }

    if (this.sigintHandler) {
      process.on('SIGINT', this.sigintHandler);
    }

    this.isInstalled = true;
  }

  public uninstall(): void {
    if (!this.isInstalled) return;

    process.removeListener('beforeExit', this.beforeExitHandler);

    if (this.sigtermHandler) {
      process.removeListener('SIGTERM', this.sigtermHandler);
      this.sigtermHandler = undefined;
    }

    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
      this.sigintHandler = undefined;
    }

    this.isInstalled = false;
  }
}
