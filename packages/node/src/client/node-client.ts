import { TraceXClient } from '@tracex/core';
import { ServerEnvironmentProvider, detectRuntime } from '../integrations/environment';
import { HttpBreadcrumbInterceptor } from '../integrations/http-instrumentation';
import { ServerRuntimeListener } from '../integrations/error-listeners';
import { ProcessLifecycleManager } from '../integrations/lifecycle';
import { TraceXNodeOptions, ServerEnvironmentContext } from '../types';

/**
 * Server-specialized TraceX client orchestrating Node.js and Bun runtime detection,
 * live OS forensics, error listeners, HTTP breadcrumb interception, and graceful shutdown.
 */
export class TraceXNodeClient extends TraceXClient {
  private readonly nodeOptions: TraceXNodeOptions;
  private readonly envProvider: ServerEnvironmentProvider;
  private readonly httpInterceptor?: HttpBreadcrumbInterceptor;
  private readonly runtimeListener?: ServerRuntimeListener;
  private readonly lifecycleManager?: ProcessLifecycleManager;
  private closePromise?: Promise<boolean>;

  constructor(options: TraceXNodeOptions) {
    const runtimeInfo = detectRuntime();
    const envProvider = new ServerEnvironmentProvider();
    const staticContext = envProvider.getStaticContext();

    const defaultEnvName =
      typeof process !== 'undefined' && process.env?.NODE_ENV
        ? process.env.NODE_ENV
        : 'development';

    // Prepare enriched environment context
    let environmentOption: ServerEnvironmentContext;
    if (typeof options.environment === 'string') {
      environmentOption = {
        environment_name: options.environment,
        ...staticContext,
      } as ServerEnvironmentContext;
    } else if (typeof options.environment === 'object' && options.environment !== null) {
      environmentOption = {
        environment_name:
          (options.environment as any).environment_name || defaultEnvName,
        ...staticContext,
        ...options.environment,
      } as ServerEnvironmentContext;
    } else {
      environmentOption = {
        environment_name: defaultEnvName,
        ...staticContext,
      } as ServerEnvironmentContext;
    }

    super({
      ...options,
      platform: options.platform || runtimeInfo.platform,
      language: options.language || 'javascript',
      environment: environmentOption,
    });

    this.nodeOptions = { ...options };
    this.envProvider = envProvider;

    const instrumentHttp = options.instrumentHttp !== false;
    const instrumentFetch =
      options.instrumentFetch !== undefined ? options.instrumentFetch : instrumentHttp;

    // 1. Install HttpBreadcrumbInterceptor
    if (instrumentHttp || instrumentFetch) {
      this.httpInterceptor = new HttpBreadcrumbInterceptor(this, options.endpoint, {
        instrumentHttp,
        instrumentFetch,
      });
      this.httpInterceptor.install();
    }

    // 2. Install ServerRuntimeListener
    if (
      options.captureUncaughtExceptions !== false ||
      options.captureUnhandledRejections !== false
    ) {
      this.runtimeListener = new ServerRuntimeListener(this, this.nodeOptions);
      this.runtimeListener.install();
    }

    // 3. Install ProcessLifecycleManager
    if (options.instrumentLifecycle !== false) {
      this.lifecycleManager = new ProcessLifecycleManager(this, {
        hookSignals: options.hookSignals,
      });
      this.lifecycleManager.install();
    }
  }

  /**
   * Returns configured Node options.
   */
  public getNodeOptions(): Readonly<TraceXNodeOptions> {
    return this.nodeOptions;
  }

  /**
   * Returns server environment provider.
   */
  public getEnvironmentProvider(): ServerEnvironmentProvider {
    return this.envProvider;
  }

  /**
   * Returns active HTTP breadcrumb interceptor if enabled.
   */
  public getHttpInterceptor(): HttpBreadcrumbInterceptor | undefined {
    return this.httpInterceptor;
  }

  /**
   * Returns active runtime error listener if enabled.
   */
  public getRuntimeListener(): ServerRuntimeListener | undefined {
    return this.runtimeListener;
  }

  /**
   * Returns active process lifecycle manager if enabled.
   */
  public getLifecycleManager(): ProcessLifecycleManager | undefined {
    return this.lifecycleManager;
  }

  /**
   * Captures an exception, dynamically sampling live memory and uptime metrics at capture time.
   */
  public override captureException(
    error: unknown,
    context?: Record<string, unknown>
  ): string | undefined {
    try {
      const liveMetrics = this.envProvider.getLiveMetrics();
      const mergedContext = {
        ...liveMetrics,
        ...(context || {}),
      };
      return super.captureException(error, mergedContext);
    } catch (err) {
      if (this.nodeOptions.debug) {
        console.warn('[TraceX] Failed to sample server forensics at crash time:', err);
      }
      return super.captureException(error, context);
    }
  }

  /**
   * Teardown client: uninstalls listeners and interceptors, then flushes queue.
   * Caches and returns pending close promise on concurrent calls.
   */
  public override close(timeoutMs?: number): Promise<boolean> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      try {
        this.lifecycleManager?.uninstall();
      } catch {}

      try {
        this.runtimeListener?.uninstall();
      } catch {}

      try {
        this.httpInterceptor?.uninstall();
      } catch {}

      return super.close(timeoutMs);
    })();

    return this.closePromise;
  }
}
