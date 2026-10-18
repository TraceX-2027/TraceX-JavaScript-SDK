import type { EnvironmentContext } from '@tracex-dev/core';
import type { VercelEnvironmentContext } from '../types/index';

/**
 * Provider harvesting deployment and runtime metadata from Vercel hosting
 * and Next.js serverless environments.
 */
export class VercelEnvironmentProvider {
  private readonly env: Record<string, string | undefined>;

  constructor(env?: Record<string, string | undefined>) {
    this.env = env ?? (typeof process !== 'undefined' && process.env ? process.env : {});
  }

  /**
   * Returns true if executing in a Vercel-hosted environment.
   */
  public isVercel(): boolean {
    return Boolean(this.env.VERCEL || this.env.VERCEL_ENV);
  }

  /**
   * Extracts Vercel and Next.js serverless hosting forensics metadata.
   * Completely safe and non-blocking if variables are missing.
   */
  public getVercelContext(): VercelEnvironmentContext {
    const ctx: VercelEnvironmentContext = {};

    if (this.env.VERCEL_ENV) {
      ctx.vercel_env = this.env.VERCEL_ENV;
    }

    if (this.env.VERCEL_REGION) {
      ctx.vercel_region = this.env.VERCEL_REGION;
    }

    if (this.env.VERCEL_GIT_COMMIT_SHA) {
      ctx.vercel_commit_sha = this.env.VERCEL_GIT_COMMIT_SHA;
    }

    if (this.env.NEXT_RUNTIME) {
      ctx.next_runtime = this.env.NEXT_RUNTIME;
      ctx.runtime = this.env.NEXT_RUNTIME;
    } else {
      ctx.runtime =
        typeof process !== 'undefined'
          ? (globalThis as any).Bun
            ? 'bun'
            : process.release?.name || 'nodejs'
          : 'unknown';
    }

    return ctx;
  }

  /**
   * Enriches standard telemetry environment context with Vercel and serverless metadata.
   */
  public getEnvironmentContext(): Partial<EnvironmentContext> {
    return this.getVercelContext() as Partial<EnvironmentContext>;
  }
}
