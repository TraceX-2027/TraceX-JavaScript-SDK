import { describe, expect, it } from 'bun:test';
import { DefaultFetchTransport, HttpTelemetryDispatcher } from '../src/transport/http-dispatcher';
import { CrashEventPayload, ITransport, TransportResponse } from '../src/types';

function createDummyPayload(id = 'test_error'): CrashEventPayload {
  return {
    project_key: 'tracex_live_test123',
    occurred_at: new Date().toISOString(),
    platform: 'javascript',
    exception_type: 'TestError',
    error_message: id,
    stack_trace: 'stack',
    environment: { environment_name: 'test' },
    breadcrumbs: [],
  };
}

describe('HttpTelemetryDispatcher', () => {
  it('delivers telemetry and advances queue on HTTP 202 Accepted', async () => {
    const sentRequests: { url: string; projectKey: string; payload: CrashEventPayload }[] = [];

    const mockTransport: ITransport = {
      async send(url, projectKey, payload): Promise<TransportResponse> {
        sentRequests.push({ url, projectKey, payload });
        return {
          status: 202,
          body: JSON.stringify({ status: 'accepted', event_id: 'evt_123' }),
        };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      endpoint: 'https://api.tracex.dev/api/v1/crashes',
      transport: mockTransport,
    });

    dispatcher.enqueue(createDummyPayload('payload_1'));
    dispatcher.enqueue(createDummyPayload('payload_2'));

    const flushed = await dispatcher.flush(3000);
    expect(flushed).toBe(true);
    expect(dispatcher.queueLength).toBe(0);
    expect(sentRequests).toHaveLength(2);
    expect(sentRequests[0].payload.error_message).toBe('payload_1');
    expect(sentRequests[1].payload.error_message).toBe('payload_2');

    await dispatcher.close();
  });

  it('delays queue processing on HTTP 429 Too Many Requests and retries successfully', async () => {
    let attempt = 0;
    const timestamps: number[] = [];

    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        attempt += 1;
        timestamps.push(Date.now());
        if (attempt === 1) {
          return {
            status: 429,
            headers: { 'retry-after': '0.1' }, // 100ms
            body: 'Rate limited',
          };
        }
        return {
          status: 202,
          body: 'Accepted',
        };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
    });

    dispatcher.enqueue(createDummyPayload('rate_limited_event'));

    const flushed = await dispatcher.flush(3000);
    expect(flushed).toBe(true);
    expect(attempt).toBe(2);
    expect(dispatcher.queueLength).toBe(0);

    // Verify delay between first and second attempt was at least ~90ms
    const delay = timestamps[1] - timestamps[0];
    expect(delay).toBeGreaterThanOrEqual(80);

    await dispatcher.close();
  });

  it('retries up to maxRetries on HTTP 500 error with backoff then drops event', async () => {
    let attempts = 0;
    const dropped: { payload: CrashEventPayload; reason: string }[] = [];

    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        attempts += 1;
        return {
          status: 500,
          body: 'Internal Server Error',
        };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
      maxRetries: 3,
      backoffDelays: [10, 20, 30], // Fast delays for tests
      jitterMax: 0,
      onDropped: (payload, reason) => {
        dropped.push({ payload, reason });
      },
    });

    dispatcher.enqueue(createDummyPayload('server_error_event'));

    const flushed = await dispatcher.flush(3000);
    expect(flushed).toBe(true);
    // 1 initial attempt + 3 retries = 4 attempts total
    expect(attempts).toBe(4);
    expect(dispatcher.queueLength).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('MAX_RETRIES_EXHAUSTED');

    await dispatcher.close();
  });

  it('halts retries immediately on HTTP 401 Unauthorized and drops event', async () => {
    let attempts = 0;
    const dropped: { payload: CrashEventPayload; reason: string }[] = [];

    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        attempts += 1;
        return {
          status: 401,
          body: 'Unauthorized project key',
        };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
      maxRetries: 3,
      onDropped: (payload, reason) => {
        dropped.push({ payload, reason });
      },
    });

    dispatcher.enqueue(createDummyPayload('unauthorized_event'));

    const flushed = await dispatcher.flush(3000);
    expect(flushed).toBe(true);
    // Exactly 1 attempt made: 401 is terminal, zero retries
    expect(attempts).toBe(1);
    expect(dispatcher.queueLength).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('HTTP_401');

    await dispatcher.close();
  });

  it('times out flush when queue cannot drain within specified timeout', async () => {
    // Transport that blocks forever
    const blockingTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        await new Promise((r) => setTimeout(r, 2000));
        return { status: 202 };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: blockingTransport,
    });

    dispatcher.enqueue(createDummyPayload('blocking_event'));

    // Flush with short timeout (50ms)
    const result = await dispatcher.flush(50);
    expect(result).toBe(false);

    await dispatcher.close(3000);
  });

  it('DefaultFetchTransport delegates to global fetch with correct headers and payload', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new DefaultFetchTransport();
      const payload = createDummyPayload('fetch_transport_test');
      const response = await transport.send(
        'https://api.tracex.dev/api/v1/crashes',
        'tracex_live_test_key',
        payload
      );

      expect(response.status).toBe(202);
      expect(capturedUrl).toBe('https://api.tracex.dev/api/v1/crashes');
      expect(capturedInit?.method).toBe('POST');
      expect((capturedInit?.headers as Record<string, string>)['X-TraceX-Key']).toBe(
        'tracex_live_test_key'
      );
      expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
      expect(capturedInit?.keepalive).toBe(true);
      expect(JSON.parse(String(capturedInit?.body)).error_message).toBe('fetch_transport_test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('close() triggers processQueue() on pending queue and successfully flushes', async () => {
    let delivered = 0;
    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        delivered += 1;
        return { status: 202 };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
    });

    dispatcher.enqueue(createDummyPayload('close_test'));
    const result = await dispatcher.close(2000);
    expect(result).toBe(true);
    expect(delivered).toBe(1);
    expect(dispatcher.queueLength).toBe(0);
  });

  it('enforces maxQueueSize and discards oldest item on overflow', async () => {
    const droppedReasons: string[] = [];
    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        return { status: 202 };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
      maxQueueSize: 2,
      onDropped: (_payload, reason) => {
        droppedReasons.push(reason);
      },
    });

    // Enqueue 3 items synchronously; oldest should be evicted
    dispatcher.enqueue(createDummyPayload('item1'));
    dispatcher.enqueue(createDummyPayload('item2'));
    dispatcher.enqueue(createDummyPayload('item3'));

    await dispatcher.close(2000);
    expect(dispatcher.queueLength).toBe(0);
    expect(droppedReasons).toContain('QUEUE_OVERFLOW');
  });

  it('bounds HTTP 429 retries to maxRetries and drops event', async () => {
    let attempts = 0;
    const dropped: { payload: CrashEventPayload; reason: string }[] = [];

    const mockTransport: ITransport = {
      async send(): Promise<TransportResponse> {
        attempts += 1;
        return {
          status: 429,
          headers: { 'retry-after': '0.01' },
          body: 'Rate limited',
        };
      },
    };

    const dispatcher = new HttpTelemetryDispatcher({
      projectKey: 'tracex_live_test123',
      transport: mockTransport,
      maxRetries: 2,
      onDropped: (payload, reason) => {
        dropped.push({ payload, reason });
      },
    });

    dispatcher.enqueue(createDummyPayload('429_exhausted'));
    const flushed = await dispatcher.flush(2000);
    expect(flushed).toBe(true);
    // Initial attempt (1) + 2 retries = 3 attempts total
    expect(attempts).toBe(3);
    expect(dispatcher.queueLength).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('MAX_RETRIES_EXHAUSTED');

    await dispatcher.close();
  });
});
