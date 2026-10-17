import { TraceXClient } from '@tracex/core';
import { BrowserEnvironmentProvider } from '../integrations/environment';
import { BrowserErrorListeners } from '../integrations/error-listeners';
import { DOMClickTracker } from '../integrations/dom-tracker';
import { NavigationTracker } from '../integrations/navigation-tracker';
import type { TraceXReactOptions, BrowserEnvironmentContext } from '../types';

/**
 * React and browser-specialized TraceX client orchestrating DOM click tracking,
 * navigation routing breadcrumbs, unhandled error/rejection listening, and client forensics.
 */
export class TraceXReactClient extends TraceXClient {
  private readonly reactOptions: TraceXReactOptions;
  private readonly envProvider: BrowserEnvironmentProvider;
  private readonly errorListeners?: BrowserErrorListeners;
  private readonly domTracker?: DOMClickTracker;
  private readonly navigationTracker?: NavigationTracker;
  private closePromise?: Promise<boolean>;

  private readonly visibilityChangeHandler = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.flush().catch(() => {});
    }
  };

  private readonly pageHideHandler = (): void => {
    this.flush().catch(() => {});
  };

  constructor(options: TraceXReactOptions) {
    if (!options || typeof options !== 'object' || typeof options.projectKey !== 'string') {
      throw new Error("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    }

    const envProvider = new BrowserEnvironmentProvider();
    const staticContext = envProvider.getEnvironmentContext();

    const defaultEnvName = 'development';
    let environmentOption: BrowserEnvironmentContext;
    if (typeof options.environment === 'string') {
      environmentOption = {
        environment_name: options.environment,
        ...staticContext,
      };
    } else if (typeof options.environment === 'object' && options.environment !== null) {
      environmentOption = {
        environment_name: (options.environment as any).environment_name || defaultEnvName,
        ...staticContext,
        ...options.environment,
      };
    } else {
      environmentOption = {
        environment_name: defaultEnvName,
        ...staticContext,
      };
    }

    super({
      ...options,
      platform: options.platform || 'browser',
      language: options.language || 'javascript',
      environment: environmentOption,
    });

    this.reactOptions = { ...options };
    this.envProvider = envProvider;

    // Bind methods for safe destructuring
    this.captureException = this.captureException.bind(this);
    this.addBreadcrumb = this.addBreadcrumb.bind(this);

    // Isomorphic check: only attach listeners if running inside a browser environment
    const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (inBrowser) {
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
      window.addEventListener('pagehide', this.pageHideHandler);

      if (options.instrumentErrors !== false) {
        this.errorListeners = new BrowserErrorListeners(this);
        this.errorListeners.install();
      }

      if (options.instrumentClicks !== false) {
        this.domTracker = new DOMClickTracker(this, this.getScrubber());
        this.domTracker.install();
      }

      if (options.instrumentNavigation !== false) {
        this.navigationTracker = new NavigationTracker(this, this.getScrubber());
        this.navigationTracker.install();
      }
    }
  }

  /**
   * Returns configured React options.
   */
  public getReactOptions(): Readonly<TraceXReactOptions> {
    return this.reactOptions;
  }

  /**
   * Returns browser environment forensics provider.
   */
  public getEnvironmentProvider(): BrowserEnvironmentProvider {
    return this.envProvider;
  }

  /**
   * Returns active error listeners if enabled.
   */
  public getErrorListeners(): BrowserErrorListeners | undefined {
    return this.errorListeners;
  }

  /**
   * Returns active DOM click tracker if enabled.
   */
  public getDomTracker(): DOMClickTracker | undefined {
    return this.domTracker;
  }

  /**
   * Returns active navigation tracker if enabled.
   */
  public getNavigationTracker(): NavigationTracker | undefined {
    return this.navigationTracker;
  }

  /**
   * Captures an exception, dynamically enriching it with live browser forensics at crash time.
   */
  public override captureException(
    error: unknown,
    context?: Record<string, unknown>
  ): string | undefined {
    try {
      const liveForensics = this.envProvider.getEnvironmentContext();
      const mergedContext = {
        ...liveForensics,
        ...(context || {}),
      };
      return super.captureException(error, mergedContext);
    } catch (err) {
      if (this.reactOptions.debug) {
        console.warn('[TraceX] Failed to harvest browser forensics at crash time:', err);
      }
      return super.captureException(error, context);
    }
  }

  /**
   * Teardown client: uninstalls listeners, removes click tracker, restores history, and flushes queue.
   */
  public override close(timeoutMs?: number): Promise<boolean> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      try {
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        }
        if (typeof window !== 'undefined') {
          window.removeEventListener('pagehide', this.pageHideHandler);
        }
      } catch {}

      try {
        this.domTracker?.uninstall();
      } catch {}

      try {
        this.navigationTracker?.uninstall();
      } catch {}

      try {
        this.errorListeners?.uninstall();
      } catch {}

      return super.close(timeoutMs);
    })();

    return this.closePromise;
  }
}
