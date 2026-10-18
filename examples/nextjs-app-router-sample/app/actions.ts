'use server';

import { withTraceXServerAction, TraceX as TraceXServer } from '@tracex-dev/nextjs/server';

if (!TraceXServer.getClient()) {
  TraceXServer.init({
    projectKey:
      process.env.NEXT_PUBLIC_TRACEX_PROJECT_KEY ||
      process.env.TRACEX_PROJECT_KEY ||
      'tracex_live_demo_00000000',
    endpoint: process.env.NEXT_PUBLIC_TRACEX_ENDPOINT || process.env.TRACEX_ENDPOINT,
    environment: process.env.NODE_ENV || 'development',
  });
}

/**
 * Server Action demonstrating automatic error interception, execution duration profiling,
 * and PII credential sanitization (passwords, auth tokens scrubbed in telemetry).
 */
export const triggerServerActionFailure = withTraceXServerAction(
  'triggerServerActionFailure',
  async (formData: FormData) => {
    const username = formData.get('username') as string;
    const scenario = formData.get('scenario') as string;

    // Simulate backend latency
    await new Promise((resolve) => setTimeout(resolve, 120));

    if (scenario === 'database_lock') {
      throw new Error(
        `[PostgresTransactionTimeout] Deadlock detected during atomic update for account '${username || 'anonymous'}'`
      );
    }

    if (scenario === 'upstream_auth') {
      throw new Error(
        `[UpstreamOAuthFailure] Internal token validation service rejected credentials with HTTP 502`
      );
    }

    throw new Error(
      `[ServerActionException] Transaction rejected for user '${username || 'anonymous'}': Insufficient quota.`
    );
  }
);
