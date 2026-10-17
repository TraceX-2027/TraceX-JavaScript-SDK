import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Cross-package imports
import {
  BreadcrumbRingBuffer,
  HttpTelemetryDispatcher,
  TraceXClient,
  type ITransport,
  type CrashEventPayload,
  type TransportResponse,
} from '@tracex/core';
import { TraceXNodeClient } from '@tracex/node';
import {
  TraceXErrorBoundary,
  TraceXReactClient,
} from '@tracex/react';
import {
  withTraceXServerAction,
  withTraceXRoute,
  TraceX as TraceXServer,
} from '@tracex/nextjs/server';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  public responses: TransportResponse[] = [];
  public callTimes: number[] = [];

  constructor(private readonly responseFactory?: (payload: CrashEventPayload, attempt: number) => TransportResponse) {}

  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.callTimes.push(Date.now());
    this.payloads.push(payload);

    if (this.responseFactory) {
      const res = this.responseFactory(payload, this.payloads.length);
      this.responses.push(res);
      return res;
    }

    const defaultRes = { status: 202, body: JSON.stringify({ status: 'accepted', event_id: payload.event_id }) };
    this.responses.push(defaultRes);
    return defaultRes;
  }
}

describe('E2E Telemetry Pipeline Integration Suite', () => {
  describe('Scenario 1: E2E Ring Buffer Truncation & FIFO Eviction', () => {
    it('stores exactly the latest 50 breadcrumbs with strictly increasing monotonic sequence order (11 to 60)', async () => {
      const transport = new MockTransport();
      const client = new TraceXClient({
        projectKey: 'tracex_live_e2e_ring_buffer_0001',
        transport,
      });

      // Emit 60 breadcrumbs sequentially
      for (let i = 1; i <= 60; i++) {
        client.addBreadcrumb({
          category: 'user.action',
          action: 'click',
          target: `button_${i}`,
          data: { step: i },
        });
      }

      // Trigger crash event capture to snapshot breadcrumbs
      const eventId = client.captureException(new Error('Buffer Capacity Overflow'));
      expect(eventId).toBeDefined();

      await client.flush();
      expect(transport.payloads.length).toBe(1);

      const capturedPayload = transport.payloads[0];
      const capturedBreadcrumbs = capturedPayload.breadcrumbs;

      // Must be capped strictly at ring buffer capacity (50)
      expect(capturedBreadcrumbs).toHaveLength(50);

      // Verify strictly monotonic sequence orders from 11 through 60
      const sequenceOrders = capturedBreadcrumbs.map((b) => b.sequence_order);
      const expectedOrders = Array.from({ length: 50 }, (_, idx) => idx + 11);
      expect(sequenceOrders).toEqual(expectedOrders);

      // Verify the first 10 were cleanly evicted FIFO
      expect(capturedBreadcrumbs[0].target).toBe('button_11');
      expect(capturedBreadcrumbs[capturedBreadcrumbs.length - 1].target).toBe('button_60');

      await client.close();
    });
  });

  describe('Scenario 2: E2E PII & Secret Redaction', () => {
    it('scrubs Bearer tokens, passwords, credit card numbers, and local file paths across payload', async () => {
      const transport = new MockTransport();
      const client = new TraceXNodeClient({
        projectKey: 'tracex_live_e2e_scrubber_0002',
        transport,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      // Add a breadcrumb containing Bearer token and valid Luhn credit card
      client.addBreadcrumb({
        category: 'http.request',
        action: 'POST',
        target: 'https://api.example.com/checkout?token=super_secret_query_tok',
        data: {
          customHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy',
          note: 'Paying with Visa 4012 8888 8888 1881 in cart',
        },
      });

      // Capture an error with sensitive message, stack path, and context
      const error = new Error('Auth failed with Bearer secret_jwt_token_999 at C:\\Users\\Administrator\\Projects\\app.ts:42');
      const eventId = client.captureException(error, {
        password: 'UserPlainTextPassword123!',
        apiKey: 'key_live_9876543210',
        metadata: {
          clientSecret: 'secret_live_abcxyz',
          normalField: 'public_data',
          card: '4012-8888-8888-1881',
        },
      });

      expect(eventId).toBeDefined();
      await client.flush();
      expect(transport.payloads.length).toBe(1);

      const payload = transport.payloads[0];

      // Error message scrubbed
      expect(payload.error_message).toContain('Bearer [REDACTED]');
      expect(payload.error_message).not.toContain('secret_jwt_token_999');

      // Stack trace path scrubbed
      if (payload.stack_trace) {
        expect(payload.stack_trace).not.toContain('C:\\Users\\Administrator');
      }

      // Context scrubbed
      const env = payload.environment as Record<string, any>;
      expect(env.password).toBe('[REDACTED]');
      expect(env.apiKey).toBe('[REDACTED]');
      expect(env.metadata.clientSecret).toBe('[REDACTED]');
      expect(env.metadata.normalField).toBe('public_data');
      expect(env.metadata.card).toBe('[CARD_REDACTED]');

      // Breadcrumb scrubbed
      const breadcrumb = payload.breadcrumbs[0];
      expect(breadcrumb.target).toContain('token=[REDACTED]');
      expect(breadcrumb.data?.customHeader).toBe('Bearer [REDACTED]');
      expect(breadcrumb.data?.note).toContain('[CARD_REDACTED]');
      expect(breadcrumb.data?.note).not.toContain('4012 8888 8888 1881');

      await client.close();
    });
  });

  describe('Scenario 3: E2E 429 Rate Limit Backoff & Queue Retry', () => {
    it('pauses queue dispatch upon 429 with Retry-After, backs off, and delivers payload successfully', async () => {
      let attempts = 0;
      const attemptTimes: number[] = [];

      const transport: ITransport = {
        async send(_url: string, _projectKey: string, _payload: CrashEventPayload): Promise<TransportResponse> {
          attempts += 1;
          attemptTimes.push(Date.now());

          if (attempts === 1) {
            // Return 429 with Retry-After: 0.1 (100ms)
            return {
              status: 429,
              headers: {
                'retry-after': '0.1',
              },
              body: JSON.stringify({ error: 'Too Many Requests', retry_after: 0.1 }),
            };
          }

          return {
            status: 202,
            body: JSON.stringify({ status: 'accepted', event_id: 'evt_recovered_429' }),
          };
        },
      };

      const dispatcher = new HttpTelemetryDispatcher({
        projectKey: 'tracex_live_e2e_rate_limit_0003',
        endpoint: 'https://api.tracex.dev/api/v1/crashes',
        transport,
        maxRetries: 3,
      });

      const dummyPayload: CrashEventPayload = {
        event_id: 'evt_test_429',
        project_key: 'tracex_live_e2e_rate_limit_0003',
        occurred_at: new Date().toISOString(),
        platform: 'node',
        exception_type: 'RateLimitTestError',
        error_message: 'Trigger 429 backoff test',
        stack_trace: 'Error: RateLimitTestError\n    at test',
        environment: { environment_name: 'test' },
        breadcrumbs: [],
      };

      dispatcher.enqueue(dummyPayload);

      // Await queue draining with sufficient timeout for the 100ms retry-after delay
      const flushed = await dispatcher.flush(3000);

      expect(flushed).toBe(true);
      expect(attempts).toBe(2);
      expect(dispatcher.queueLength).toBe(0);

      // Verify backoff delay occurred between attempt 1 and attempt 2
      const timeDiffMs = attemptTimes[1] - attemptTimes[0];
      expect(timeDiffMs).toBeGreaterThanOrEqual(80);

      await dispatcher.close();
    });
  });

  describe('Scenario 4: E2E React Error Boundary', () => {
    let win: GlobalWindow;
    let container: HTMLDivElement;
    let root: Root;
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
      win = new GlobalWindow({ url: 'http://localhost/' });
      (win as any).reportError = () => {};
      Object.assign(globalThis, {
        window: win,
        document: win.document,
        navigator: win.navigator,
        location: win.location,
        history: win.history,
        screen: win.screen,
        HTMLElement: win.HTMLElement,
        HTMLInputElement: win.HTMLInputElement,
        Event: win.Event,
        CustomEvent: win.CustomEvent,
        MouseEvent: win.MouseEvent,
      });

      container = win.document.createElement('div') as any;
      win.document.body.appendChild(container as any);
      root = createRoot(container as any);

      originalConsoleError = console.error;
      console.error = () => {};
    });

    afterEach(async () => {
      console.error = originalConsoleError;
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 60));
      (container as any).remove();

      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).navigator;
      delete (globalThis as any).location;
      delete (globalThis as any).history;
      delete (globalThis as any).screen;
      delete (globalThis as any).HTMLElement;
      delete (globalThis as any).HTMLInputElement;
      delete (globalThis as any).Event;
      delete (globalThis as any).CustomEvent;
      delete (globalThis as any).MouseEvent;
    });

    it('catches render error, renders fallback with reference ID, captures componentStack, and recovers on reset', async () => {
      const transport = new MockTransport();
      const client = new TraceXReactClient({
        projectKey: 'tracex_test_react_e2e_0004',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      function BuggyComponent({ shouldThrow }: { shouldThrow: boolean }) {
        if (shouldThrow) {
          throw new Error('Explosive Client Render Error');
        }
        return React.createElement('div', { 'data-testid': 'recovered-content' }, 'Safe Content Rendered');
      }

      function App() {
        const [hasError, setHasError] = useState(true);
        return React.createElement(
          TraceXErrorBoundary,
          {
            client,
            fallback: ({ error, reset, eventId }) =>
              React.createElement(
                'div',
                { 'data-testid': 'fallback-ui' },
                React.createElement('span', { 'data-testid': 'error-msg' }, error.message),
                React.createElement('span', { 'data-testid': 'ref-id' }, eventId),
                React.createElement(
                  'button',
                  {
                    'data-testid': 'reset-btn',
                    onClick: () => {
                      setHasError(false);
                      reset();
                    },
                  },
                  'Try again'
                )
              ),
          },
          React.createElement(BuggyComponent, { shouldThrow: hasError })
        );
      }

      // Render the crashing component tree
      await new Promise<void>((resolve) => {
        root.render(React.createElement(App));
        setTimeout(resolve, 50);
      });

      // Verify Fallback UI rendered
      const fallbackElem = container.querySelector('[data-testid="fallback-ui"]');
      expect(fallbackElem).not.toBeNull();
      expect(container.querySelector('[data-testid="error-msg"]')?.textContent).toBe('Explosive Client Render Error');

      const refId = container.querySelector('[data-testid="ref-id"]')?.textContent;
      expect(refId).toBeDefined();
      expect(refId).toMatch(/^evt_/);

      // Verify Telemetry dispatch
      await client.flush();
      expect(transport.payloads.length).toBe(1);

      const payload = transport.payloads[0];
      expect(payload.error_message).toBe('Explosive Client Render Error');
      expect(payload.environment.mechanism).toBe('react.error_boundary');
      expect(payload.environment.componentStack).toBeDefined();
      expect(String(payload.environment.componentStack)).toContain('BuggyComponent');

      // Click "Try again" to recover the tree
      const resetBtn = container.querySelector('[data-testid="reset-btn"]') as HTMLButtonElement;
      expect(resetBtn).not.toBeNull();

      await new Promise<void>((resolve) => {
        resetBtn.click();
        setTimeout(resolve, 50);
      });

      // Tree is recovered
      expect(container.querySelector('[data-testid="recovered-content"]')?.textContent).toBe('Safe Content Rendered');
      expect(container.querySelector('[data-testid="fallback-ui"]')).toBeNull();

      await client.close();
    });
  });

  describe('Scenario 5: E2E Next.js Server Action', () => {
    it('executes server action successfully, returning payload and recording action.server breadcrumb', async () => {
      const transport = new MockTransport();
      TraceXServer.reset();
      TraceXServer.init({
        projectKey: 'tracex_test_server_action_success_0005',
        transport,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      const successAction = withTraceXServerAction('updateProfile', async (formData: FormData) => {
        const username = formData.get('username');
        return { success: true, user: username };
      });

      const formData = new FormData();
      formData.append('username', 'charlie');
      const result = await successAction(formData);
      expect(result).toEqual({ success: true, user: 'charlie' });

      // Trigger checkpoint to inspect breadcrumbs
      TraceXServer.captureException(new Error('Checkpoint'));
      await TraceXServer.flush();
      expect(transport.payloads.length).toBe(1);

      const payload = transport.payloads[0];
      const bc = payload.breadcrumbs.find((b) => b.category === 'action.server');
      expect(bc).toBeDefined();
      expect(bc?.action).toBe('updateProfile');
      expect(bc?.data?.action_name).toBe('updateProfile');
      expect(typeof bc?.data?.duration_ms).toBe('number');

      await TraceXServer.close();
      TraceXServer.reset();
    });

    it('tracks action execution, scrubs FormData credentials, captures crash telemetry, and rethrows original error', async () => {
      const transport = new MockTransport();
      TraceXServer.reset();
      TraceXServer.init({
        projectKey: 'tracex_test_server_action_e2e_0005',
        transport,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      const serverAction = withTraceXServerAction('processUserRegistration', async (formData: FormData) => {
        const username = formData.get('username');
        if (username === 'forbidden_user') {
          throw new Error('Registration Rejected: Account quota exceeded');
        }
        return { success: true };
      });

      const formData = new FormData();
      formData.append('username', 'forbidden_user');
      formData.append('password', 'SuperSecretP@ssword999');
      formData.append('apiKey', 'key_live_server_secret');

      let thrownError: unknown;
      try {
        await serverAction(formData);
      } catch (err) {
        thrownError = err;
      }

      // Preserves original exception and rethrows
      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toBe('Registration Rejected: Account quota exceeded');

      // Verify captured telemetry payload
      await TraceXServer.flush();
      expect(transport.payloads.length).toBe(1);

      const payload = transport.payloads[0];
      expect(payload.error_message).toBe('Registration Rejected: Account quota exceeded');
      expect(payload.environment.mechanism).toBe('nextjs.server_action');
      expect(payload.environment.action_name).toBe('processUserRegistration');
      expect(typeof payload.environment.duration_ms).toBe('number');

      // Verify scrubbed arguments in telemetry
      const scrubbedArgs = payload.environment.arguments as Record<string, any>[];
      expect(scrubbedArgs).toBeDefined();
      expect(scrubbedArgs[0].username).toBe('forbidden_user');
      expect(scrubbedArgs[0].password).toBe('[REDACTED]');
      expect(scrubbedArgs[0].apiKey).toBe('[REDACTED]');

      // Verify breadcrumb emission for action.server
      const serverActionBreadcrumb = payload.breadcrumbs.find((b) => b.category === 'action.server');
      expect(serverActionBreadcrumb).toBeDefined();
      expect(serverActionBreadcrumb?.action).toBe('processUserRegistration');
      expect(serverActionBreadcrumb?.data?.action_name).toBe('processUserRegistration');
      expect(serverActionBreadcrumb?.data?.status).toBe('error');

      await TraceXServer.close();
      TraceXServer.reset();
    });
  });

  describe('Scenario 6: E2E Next.js Route Handler', () => {
    it('catches uncaught route exception, returns RFC 7807 500 JSON with trace_id, and dispatches telemetry', async () => {
      const transport = new MockTransport();
      TraceXServer.reset();
      TraceXServer.init({
        projectKey: 'tracex_test_route_handler_e2e_0006',
        transport,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      const handler = withTraceXRoute(async (_req: Request) => {
        throw new Error('Simulated Database Pool Timeout in API route');
      });

      const request = new Request('http://localhost:3000/api/checkout?token=secret123', {
        method: 'POST',
      });

      const response = await handler(request);

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toBe('application/problem+json');

      const body = await response.json();
      expect(body.type).toBe('https://tracex.dev/errors/internal-server-error');
      expect(body.title).toBe('Internal Server Error');
      expect(body.status).toBe(500);
      expect(body.detail).toBe('An unhandled server error occurred while processing the request.');
      expect(body.trace_id).toBeDefined();
      expect(body.trace_id).toMatch(/^evt_/);

      expect(transport.payloads.length).toBe(1);
      const payload = transport.payloads[0];
      expect(payload.error_message).toBe('Simulated Database Pool Timeout in API route');
      expect(payload.environment.mechanism).toBe('nextjs.route_handler');
      expect(payload.environment.method).toBe('POST');
      expect(payload.environment.url).toBe('http://localhost:3000/api/checkout?token=[REDACTED]');
      expect(payload.event_id).toBe(body.trace_id);

      await TraceXServer.close();
      TraceXServer.reset();
    });
  });
});
