import { withTraceXRoute, TraceX as TraceXServer } from '@tracex-dev/nextjs/server';

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
 * Route handler demonstrating automatic crash interception and RFC 7807
 * problem details response generation with correlating `trace_id`.
 */
export const GET = withTraceXRoute(async (request: Request) => {
  const url = new URL(request.url);
  const crashType = url.searchParams.get('type') || 'db_exhausted';

  if (crashType === 'gateway_timeout') {
    throw new Error('Upstream microservice timed out after 5000ms');
  }

  throw new Error('Simulated Route Handler Crash: Postgres connection pool exhausted');
});

export const POST = withTraceXRoute(async (request: Request) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch {}

  throw new Error(
    `Unhandled Route Handler Crash during POST execution: ${body?.action || 'unknown_payload'}`
  );
});
