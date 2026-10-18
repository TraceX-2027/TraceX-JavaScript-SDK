import type { BreadcrumbInput } from '@tracex-dev/core';
import { TraceX as TraceXNode, TraceXNodeClient } from '@tracex-dev/node';
import type { TraceXNextOptions } from '../types/index';
import { VercelEnvironmentProvider } from './environment';

/**
 * Server-side TraceX singleton manager for Next.js environments.
 * Automatically injects Vercel hosting metadata and serverless forensics.
 */
export class TraceXServer {
  private static _instance: TraceXNodeClient | undefined;

  /**
   * Initializes the global TraceX Node client singleton enriched with Vercel metadata.
   */
  public static init(options: TraceXNextOptions): TraceXNodeClient {
    const vercelProvider = new VercelEnvironmentProvider();
    const vercelContext =
      options.autoDetectVercel !== false ? vercelProvider.getVercelContext() : {};

    const defaultEnvName =
      vercelContext.vercel_env ||
      (typeof process !== 'undefined' && process.env?.NODE_ENV
        ? process.env.NODE_ENV
        : 'development');

    let environmentOption: Record<string, unknown>;
    if (typeof options.environment === 'string') {
      environmentOption = {
        environment_name: options.environment,
        ...vercelContext,
      };
    } else if (typeof options.environment === 'object' && options.environment !== null) {
      environmentOption = {
        environment_name:
          (options.environment as any).environment_name || defaultEnvName,
        ...options.environment,
        ...vercelContext,
      };
    } else {
      environmentOption = {
        environment_name: defaultEnvName,
        ...vercelContext,
      };
    }

    const nodeOptions = {
      ...options,
      environment: environmentOption,
    };

    const client = TraceXNode.init(nodeOptions);
    TraceXServer._instance = client;
    return client;
  }

  /**
   * Returns the active server client singleton.
   */
  public static getClient(): TraceXNodeClient | undefined {
    return TraceXServer._instance ?? TraceXNode.getClient();
  }

  /**
   * Captures an unhandled exception or error using the active client singleton.
   */
  public static captureException(
    error: unknown,
    context?: Record<string, unknown>
  ): string | undefined {
    const client = TraceXServer.getClient();
    return client?.captureException(error, context);
  }

  /**
   * Records a breadcrumb using the active client singleton.
   */
  public static addBreadcrumb(breadcrumb: BreadcrumbInput): void {
    const client = TraceXServer.getClient();
    client?.addBreadcrumb(breadcrumb);
  }

  /**
   * Awaits in-flight and queued telemetry events up to timeoutMs using the active client singleton.
   */
  public static async flush(timeoutMs?: number): Promise<boolean> {
    const client = TraceXServer.getClient();
    if (!client) {
      return true;
    }
    return client.flush(timeoutMs);
  }

  /**
   * Closes the active server client singleton, restores listeners, and flushes pending events.
   */
  public static async close(timeoutMs?: number): Promise<boolean> {
    const res = await TraceXNode.close(timeoutMs);
    TraceXServer._instance = undefined;
    return res;
  }

  /**
   * Resets the active server client singleton.
   */
  public static reset(): void {
    if (TraceXServer._instance) {
      TraceXServer._instance.close();
      TraceXServer._instance = undefined;
    }
    TraceXNode.reset();
  }
}

export { TraceXServer as TraceX };
