import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex-dev/core';
import { withTraceXRoute } from '../src/server/route-handler';
import { TraceX } from '../src/server/tracex-server';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('withTraceXRoute', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
    TraceX.reset();
    TraceX.init({
      projectKey: 'tracex_test_route_handler_0123456789',
      transport,
      instrumentHttp: false,
      captureUncaughtExceptions: false,
      captureUnhandledRejections: false,
      instrumentLifecycle: false,
    });
  });

  afterEach(async () => {
    await TraceX.close(100);
    TraceX.reset();
  });

  it('executes route handler successfully and passes through normal Response', async () => {
    const handler = withTraceXRoute(async (_req: Request) => {
      return Response.json({ status: 'healthy', data: [1, 2, 3] });
    });

    const req = new Request('http://localhost:3000/api/health', { method: 'GET' });
    const response = await handler(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'healthy', data: [1, 2, 3] });
    expect(transport.payloads.length).toBe(0);
  });

  it('captures crash telemetry and returns RFC 7807 JSON 500 response with trace_id', async () => {
    const handler = withTraceXRoute(async () => {
      throw new Error('Database cluster inaccessible');
    });

    const req = new Request('http://localhost:3000/api/orders', { method: 'POST' });
    const response = await handler(req);

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/problem+json');

    const body = await response.json();
    expect(body.type).toBe('https://tracex.dev/errors/internal-server-error');
    expect(body.title).toBe('Internal Server Error');
    expect(body.status).toBe(500);
    expect(body.detail).toBe('An unhandled server error occurred while processing the request.');
    expect(typeof body.trace_id).toBe('string');
    expect(body.trace_id.startsWith('evt_')).toBe(true);

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(body.trace_id).toBe(payload.event_id);
    expect(payload.error_message).toBe('Database cluster inaccessible');
    expect(payload.environment.mechanism).toBe('nextjs.route_handler');
    expect(payload.environment.url).toBe('http://localhost:3000/api/orders');
    expect(payload.environment.method).toBe('POST');
  });

  it('rethrows Next.js redirect control flow exceptions without capturing telemetry', async () => {
    const redirectError = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    redirectError.digest = 'NEXT_REDIRECT;replace;/login;307;';

    const handler = withTraceXRoute(async () => {
      throw redirectError;
    });

    const req = new Request('http://localhost:3000/api/checkout');
    await expect(handler(req)).rejects.toThrow('NEXT_REDIRECT');
    expect(transport.payloads.length).toBe(0);
  });

  it('rethrows Next.js notFound control flow exceptions without capturing telemetry', async () => {
    const notFoundError = new Error('NEXT_NOT_FOUND') as Error & { digest?: string };
    notFoundError.digest = 'NEXT_NOT_FOUND';

    const handler = withTraceXRoute(async () => {
      throw notFoundError;
    });

    const req = new Request('http://localhost:3000/api/missing');
    await expect(handler(req)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(transport.payloads.length).toBe(0);
  });

  it('captures and scrubs route parameters and sensitive query params', async () => {
    const handler = withTraceXRoute(async () => {
      throw new Error('User lookup failed');
    });

    const req = new Request('http://localhost:3000/api/items/42?token=secret_token_123', {
      method: 'GET',
    });
    const context = {
      params: {
        id: '42',
        apiKey: 'sensitive_key_xyz',
      },
    };

    const response = await handler(req, context);
    expect(response.status).toBe(500);

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.environment.url).toBe('http://localhost:3000/api/items/42?token=[REDACTED]');
    expect(payload.environment.method).toBe('GET');

    const params = payload.environment.params as Record<string, unknown>;
    expect(params.id).toBe('42');
    expect(params.apiKey).toBe('[REDACTED]');
  });

  it('supports async promise params in context (Next.js 15+)', async () => {
    const handler = withTraceXRoute(async () => {
      throw new Error('Async params error');
    });

    const req = new Request('http://localhost:3000/api/posts/99');
    const context = {
      params: Promise.resolve({ slug: 'hello-world' }),
    };

    const response = await handler(req, context);
    expect(response.status).toBe(500);

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.environment.params).toEqual({ slug: 'hello-world' });
  });

  it('rethrows original error when options.rethrow is true', async () => {
    const originalError = new Error('Explicit rethrow required');
    const handler = withTraceXRoute(
      async () => {
        throw originalError;
      },
      { rethrow: true }
    );

    const req = new Request('http://localhost:3000/api/strict', { method: 'DELETE' });

    let thrown: unknown;
    try {
      await handler(req);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(originalError);
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].environment.mechanism).toBe('nextjs.route_handler');
    expect(transport.payloads[0].environment.method).toBe('DELETE');
  });

  it('handles non-Error throwables and returns RFC 7807 response', async () => {
    const handler = withTraceXRoute(async () => {
      throw 'Raw string exception in route';
    });

    const req = new Request('http://localhost:3000/api/raw');
    const response = await handler(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.title).toBe('Internal Server Error');
    expect(typeof body.trace_id).toBe('string');
  });
});
