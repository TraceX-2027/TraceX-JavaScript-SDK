import { beforeEach, describe, expect, it } from 'bun:test';
import { TraceX, TraceXClient } from '../src/index';
import { CrashEventPayload, ITransport, TransportResponse } from '../src/types';

describe('TraceXClient & TraceX Facade', () => {
  beforeEach(() => {
    TraceX.reset();
  });

  describe('Initialization & Validation', () => {
    it('initializes successfully with valid tracex_live_ project key', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_12345678',
        environment: 'production',
      });

      expect(client).toBeInstanceOf(TraceXClient);
      expect(TraceX.getClient()).toBe(client);
      expect(client.getOptions().projectKey).toBe('tracex_live_12345678');
    });

    it('initializes successfully with valid tracex_test_ project key', () => {
      const client = TraceX.init({
        projectKey: 'tracex_test_abcdef',
        environment: 'staging',
      });

      expect(client).toBeInstanceOf(TraceXClient);
      expect(client.getOptions().projectKey).toBe('tracex_test_abcdef');
    });

    it('throws error when projectKey does not start with tracex_live_ or tracex_test_', () => {
      expect(() => {
        TraceX.init({
          projectKey: 'invalid_key',
        });
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    });

    it('throws error when projectKey is missing or empty', () => {
      expect(() => {
        // @ts-expect-error testing missing key
        TraceX.init({});
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");

      expect(() => {
        TraceX.init({ projectKey: '' });
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    });
  });

  describe('Breadcrumbs & Exception Capture', () => {
    it('records breadcrumbs sequentially with sanitization', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_test_123',
      });

      TraceX.addBreadcrumb({
        category: 'ui.tap',
        action: 'click',
        target: 'SubmitButton',
      });

      TraceX.addBreadcrumb({
        category: 'auth',
        action: 'login',
        target: 'LoginForm',
        data: {
          password: 'supersecretpassword',
          username: 'johndoe',
        },
      });

      TraceX.addBreadcrumb({
        category: 'navigation',
        action: 'navigate',
        target: '/Users/developer/dashboard',
      });

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs).toHaveLength(3);
      expect(breadcrumbs[0].sequence_order).toBe(1);
      expect(breadcrumbs[1].sequence_order).toBe(2);
      expect(breadcrumbs[2].sequence_order).toBe(3);

      // Data scrubbed silently
      expect(breadcrumbs[1].data?.password).toBe('[REDACTED]');
      expect(breadcrumbs[1].data?.username).toBe('johndoe');
      expect(breadcrumbs[2].target).toBe('[PATH_REDACTED]');
    });

    it('captures standard Error instances and enqueues scrubbed payload', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        environment: 'production',
        release: '1.2.0',
        transport: mockTransport,
      });

      const err = new TypeError('Null reference detected');
      err.stack =
        'TypeError: Null reference detected\n    at C:\\Users\\admin\\app.ts:25:10\n    at auth (Bearer secret_token_xyz)';

      TraceX.captureException(err);

      await TraceX.flush(2000);

      expect(capturedPayloads).toHaveLength(1);
      const payload = capturedPayloads[0];
      expect(payload.project_key).toBe('tracex_live_app_123');
      expect(payload.exception_type).toBe('TypeError');
      expect(payload.error_message).toBe('Null reference detected');
      expect(payload.environment.environment_name).toBe('production');
      expect(payload.environment.app_version).toBe('1.2.0');
      expect(payload.occurred_at).toBeDefined();

      // Stack trace redaction
      expect(payload.stack_trace).toContain('[PATH_REDACTED]');
      expect(payload.stack_trace).toContain('Bearer [REDACTED]');
      expect(payload.stack_trace).not.toContain('C:\\Users\\admin\\app.ts');
      expect(payload.stack_trace).not.toContain('secret_token_xyz');
    });

    it('captures non-Error throws wrapped in synthetic UnhandledException', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
      });

      TraceX.captureException('Something exploded string');

      await TraceX.flush(2000);

      expect(capturedPayloads).toHaveLength(1);
      const payload = capturedPayloads[0];
      expect(payload.exception_type).toBe('UnhandledException');
      expect(payload.error_message).toBe('Something exploded string');
      expect(payload.stack_trace).toBeDefined();
    });

    it('supports beforeSend hook to drop or transform payloads', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      let shouldDrop = true;

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
        beforeSend: (payload) => {
          if (shouldDrop) {
            return null; // Drop event
          }
          payload.environment.custom_tag = 'transformed';
          return payload;
        },
      });

      // 1. Drop event
      TraceX.captureException(new Error('Ignored error'));
      await TraceX.flush(1000);
      expect(capturedPayloads).toHaveLength(0);

      // 2. Allow event with transformation
      shouldDrop = false;
      TraceX.captureException(new Error('Allowed error'));
      await TraceX.flush(1000);
      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0].error_message).toBe('Allowed error');
      expect(capturedPayloads[0].environment.custom_tag).toBe('transformed');
    });

    it('does not throw when captureException or addBreadcrumb called before init', () => {
      expect(() => {
        TraceX.addBreadcrumb({ category: 'test', action: 'test', target: 'test' });
        TraceX.captureException(new Error('no init'));
      }).not.toThrow();
    });

    it('generates and returns eventId string on captureException', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
      });

      const eventId = TraceX.captureException(new Error('Test eventId'));
      expect(typeof eventId).toBe('string');
      expect(eventId?.startsWith('evt_')).toBe(true);

      await TraceX.flush(1000);
      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0].event_id).toBe(eventId);
    });

    it('handles circular non-Error objects gracefully without throwing', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
      });

      const circularObj: Record<string, unknown> = { errorType: 'CustomCircular' };
      circularObj.self = circularObj;

      expect(() => {
        TraceX.captureException(circularObj);
      }).not.toThrow();

      await TraceX.flush(1000);
      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0].error_message).toBe('[object Object]');
    });

    it('supports async beforeSend returning a Promise', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
        beforeSend: async (payload) => {
          await new Promise((r) => setTimeout(r, 20));
          payload.environment.async_modified = true;
          return payload;
        },
      });

      const eventId = TraceX.captureException(new Error('Async error'));
      expect(eventId).toBeDefined();

      await TraceX.flush(2000);
      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0].environment.async_modified).toBe(true);
    });

    it('drops event when beforeSend returns undefined', async () => {
      const capturedPayloads: CrashEventPayload[] = [];
      const mockTransport: ITransport = {
        async send(url, key, payload): Promise<TransportResponse> {
          capturedPayloads.push(payload);
          return { status: 202 };
        },
      };

      TraceX.init({
        projectKey: 'tracex_live_app_123',
        transport: mockTransport,
        beforeSend: () => {
          return undefined; // Drop event
        },
      });

      const eventId = TraceX.captureException(new Error('Drop me'));
      expect(eventId).toBeUndefined();

      await TraceX.flush(1000);
      expect(capturedPayloads).toHaveLength(0);
    });
  });
});
