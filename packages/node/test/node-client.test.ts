import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import http from 'node:http';
import { CrashEventPayload } from '@tracex-dev/core';
import { TraceX, TraceXNodeClient } from '../src/index';

describe('TraceXNodeClient & TraceX Facade', () => {
  let capturedPayloads: CrashEventPayload[] = [];

  beforeEach(() => {
    capturedPayloads = [];
    TraceX.reset();
  });

  afterEach(async () => {
    await TraceX.close();
  });

  describe('Initialization & Configuration', () => {
    it('initializes TraceXNodeClient with defaults and singleton pattern', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_node_default',
      });

      expect(client).toBeInstanceOf(TraceXNodeClient);
      expect(TraceX.getClient()).toBe(client);
      expect(client.getNodeOptions().projectKey).toBe('tracex_live_node_default');
      expect(client.getHttpInterceptor()).toBeDefined();
      expect(client.getRuntimeListener()).toBeDefined();
      expect(client.getLifecycleManager()).toBeDefined();
    });

    it('throws error when projectKey is invalid or missing', () => {
      expect(() => {
        TraceX.init({ projectKey: 'invalid_key' });
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");

      expect(() => {
        TraceX.init({ projectKey: '' });
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");
    });

    it('respects configuration flags disabling HTTP, listeners, or lifecycle', () => {
      const client = TraceX.init({
        projectKey: 'tracex_test_flags',
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      expect(client.getHttpInterceptor()).toBeUndefined();
      expect(client.getRuntimeListener()).toBeUndefined();
      expect(client.getLifecycleManager()).toBeUndefined();
    });

    it('falls back environment_name to process.env.NODE_ENV or development when omitted', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'custom-env';
        const client1 = TraceX.init({ projectKey: 'tracex_test_env1' });
        expect(
          (client1.getOptions().environment as any)?.environment_name
        ).toBe('custom-env');

        const client2 = TraceX.init({
          projectKey: 'tracex_test_env2',
          environment: { app_version: '1.0' },
        });
        expect(
          (client2.getOptions().environment as any)?.environment_name
        ).toBe('custom-env');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  describe('Server Environment & Forensics Enrichment', () => {
    it('enriches captured exceptions with static OS context and live RAM metrics', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_forensics',
        environment: 'staging',
        beforeSend: (payload) => {
          capturedPayloads.push(payload);
          return payload;
        },
      });

      const eventId = client.captureException(new Error('Forensics test error'));
      expect(typeof eventId).toBe('string');
      expect(capturedPayloads.length).toBe(1);

      const payload = capturedPayloads[0];
      const env = payload.environment;

      expect(env.environment_name).toBe('staging');
      expect(env.platform).toBeDefined();
      expect(env.runtime).toBeDefined();
      expect(env.runtime_version).toBeDefined();
      expect(env.os_name).toBeDefined();
      expect(env.os_version).toBeDefined();
      expect(env.device_model).toBeDefined();
      expect(env.pid).toBe(process.pid);
      expect(typeof env.total_ram_mb).toBe('number');
      expect(typeof env.free_ram_mb).toBe('number');
      expect(typeof env.process_uptime_sec).toBe('number');
      expect(typeof env.is_low_memory).toBe('boolean');
    });

    it('merges ad-hoc context with live metrics', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_context_merge',
        beforeSend: (payload) => {
          capturedPayloads.push(payload);
          return payload;
        },
      });

      client.captureException(new Error('Custom context'), {
        userId: 'usr_123',
        serviceName: 'order-service',
      });

      expect(capturedPayloads.length).toBe(1);
      const env = capturedPayloads[0].environment;
      expect(env.userId).toBe('usr_123');
      expect(env.serviceName).toBe('order-service');
      expect(typeof env.free_ram_mb).toBe('number');
      expect(typeof env.process_uptime_sec).toBe('number');
    });
  });

  describe('Lifecycle Management & beforeExit', () => {
    it('drains telemetry queue when beforeExit is emitted', async () => {
      let flushCalled = false;
      const client = TraceX.init({
        projectKey: 'tracex_test_before_exit',
      });

      const origFlush = client.flush.bind(client);
      client.flush = async (...args) => {
        flushCalled = true;
        return origFlush(...args);
      };

      process.emit('beforeExit', 0);
      await Bun.sleep(50);

      expect(flushCalled).toBe(true);
    });
  });

  describe('Teardown & Cleanup', () => {
    it('close() restores globals, unhooks listeners, and clears active singleton', async () => {
      const initialHttpRequest = http.request;
      const initialFetch = globalThis.fetch;
      const initialBeforeExitListeners = process.listeners('beforeExit').length;

      const client = TraceX.init({
        projectKey: 'tracex_live_teardown',
      });

      expect(TraceX.getClient()).toBe(client);
      expect(process.listeners('beforeExit').length).toBe(
        initialBeforeExitListeners + 1
      );

      // Concurrent close calls share the same pending promise
      const [close1, close2] = await Promise.all([TraceX.close(), TraceX.close()]);
      expect(close1).toBe(true);
      expect(close2).toBe(true);
      expect(TraceX.getClient()).toBeUndefined();

      // Verify globals and process listeners are restored
      expect(http.request).toBe(initialHttpRequest);
      expect(globalThis.fetch).toBe(initialFetch);
      expect(process.listeners('beforeExit').length).toBe(
        initialBeforeExitListeners
      );
    });

    it('TraceX facade methods are non-blocking and safe when client not initialized', async () => {
      expect(TraceX.getClient()).toBeUndefined();
      expect(() => {
        TraceX.addBreadcrumb({
          category: 'ui',
          action: 'click',
          target: 'button',
        });
      }).not.toThrow();

      expect(TraceX.captureException(new Error('Uninitialized'))).toBeUndefined();
      expect(await TraceX.flush()).toBe(true);
      expect(await TraceX.close()).toBe(true);
    });
  });
});
