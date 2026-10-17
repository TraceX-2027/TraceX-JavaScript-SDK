import type { TraceXReactClient } from '../client/react-client';

/**
 * Attaches global unhandled error and rejection listeners in browser environments.
 * Preserves pre-existing handlers and guarantees non-blocking error capture.
 */
export class BrowserErrorListeners {
  private readonly client: TraceXReactClient;
  private originalOnError: typeof window.onerror | null = null;
  private isInstalled = false;
  private readonly unhandledRejectionHandler: (event: Event | PromiseRejectionEvent) => void;

  constructor(client: TraceXReactClient) {
    this.client = client;
    this.unhandledRejectionHandler = this.onUnhandledRejection.bind(this);
  }

  /**
   * Installs window.onerror and unhandledrejection listeners.
   */
  public install(): void {
    if (typeof window === 'undefined' || this.isInstalled) {
      return;
    }

    // Preserve existing window.onerror
    this.originalOnError = window.onerror;

    window.onerror = (
      event: Event | string,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      try {
        let errorToCapture: unknown;
        let resolvedSource = source;
        let resolvedLineno = lineno;
        let resolvedColno = colno;

        if (typeof event === 'string') {
          errorToCapture = error || new Error(event);
        } else if (event && typeof event === 'object') {
          const errEvt = event as any;
          resolvedSource = errEvt.filename || source;
          resolvedLineno = errEvt.lineno !== undefined ? errEvt.lineno : lineno;
          resolvedColno = errEvt.colno !== undefined ? errEvt.colno : colno;
          errorToCapture = error || errEvt.error || new Error(errEvt.message || String(event));
        } else {
          errorToCapture = error || new Error(String(event));
        }

        const context: Record<string, unknown> = {
          mechanism: 'window.onerror',
          source: resolvedSource,
          lineno: resolvedLineno,
          colno: resolvedColno,
        };

        this.client.captureException(errorToCapture, context);
      } catch (err) {
        if (this.client.getOptions().debug) {
          console.warn('[TraceX] Error in window.onerror listener:', err);
        }
      }

      // Delegate to previously existing window.onerror
      if (typeof this.originalOnError === 'function') {
        return this.originalOnError.call(window, event, source, lineno, colno, error);
      }
      return false;
    };

    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
    this.isInstalled = true;
  }

  /**
   * Handles unhandled Promise rejections.
   */
  private onUnhandledRejection(event: Event | PromiseRejectionEvent): void {
    try {
      const reason =
        event && typeof event === 'object' && 'reason' in event
          ? (event as any).reason
          : event;
      this.client.captureException(reason, {
        mechanism: 'window.unhandledrejection',
      });
    } catch (err) {
      if (this.client.getOptions().debug) {
        console.warn('[TraceX] Error in unhandledrejection listener:', err);
      }
    }
  }

  /**
   * Restores pre-existing window.onerror and removes unhandledrejection listener.
   */
  public uninstall(): void {
    if (typeof window === 'undefined' || !this.isInstalled) {
      return;
    }

    window.onerror = this.originalOnError;
    window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    this.originalOnError = null;
    this.isInstalled = false;
  }
}
