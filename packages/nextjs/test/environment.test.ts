import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex/core';
import { VercelEnvironmentProvider } from '../src/server/environment';
import { TraceX } from '../src/server/tracex-server';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('VercelEnvironmentProvider & Serverless Forensics', () => {
  let transport: MockTransport;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    transport = new MockTransport();
    TraceX.reset();
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await TraceX.close(100);
    TraceX.reset();
  });

  describe('VercelEnvironmentProvider unit behavior', () => {
    it('extracts complete Vercel metadata when all environment variables are present', () => {
      const mockEnv = {
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_REGION: 'iad1',
        VERCEL_GIT_COMMIT_SHA: 'f87b2c01994e',
        NEXT_RUNTIME: 'nodejs',
      };

      const provider = new VercelEnvironmentProvider(mockEnv);
      expect(provider.isVercel()).toBe(true);

      const ctx = provider.getVercelContext();
      expect(ctx.vercel_env).toBe('production');
      expect(ctx.vercel_region).toBe('iad1');
      expect(ctx.vercel_commit_sha).toBe('f87b2c01994e');
      expect(ctx.next_runtime).toBe('nodejs');
      expect(ctx.runtime).toBe('nodejs');
    });

    it('gracefully handles missing environment variables with safe fallbacks', () => {
      const emptyEnv = {};
      const provider = new VercelEnvironmentProvider(emptyEnv);

      expect(provider.isVercel()).toBe(false);

      const ctx = provider.getVercelContext();
      expect(ctx.vercel_env).toBeUndefined();
      expect(ctx.vercel_region).toBeUndefined();
      expect(ctx.vercel_commit_sha).toBeUndefined();
      expect(ctx.next_runtime).toBeUndefined();
      expect(typeof ctx.runtime).toBe('string');
    });

    it('detects preview and development Vercel environments', () => {
      const previewEnv = { VERCEL_ENV: 'preview', VERCEL_REGION: 'sfo1' };
      const provider = new VercelEnvironmentProvider(previewEnv);

      expect(provider.isVercel()).toBe(true);
      expect(provider.getVercelContext().vercel_env).toBe('preview');
      expect(provider.getVercelContext().vercel_region).toBe('sfo1');
    });
  });

  describe('TraceX.init Integration on Vercel', () => {
    it('enriches client environment and captured telemetry with vercel_env, vercel_region, and vercel_commit_sha', async () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';
      process.env.VERCEL_REGION = 'iad1';
      process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234def5678';

      const client = TraceX.init({
        projectKey: 'tracex_test_vercel_0123456789012',
        transport,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      const optionsEnv = client.getOptions().environment as any;
      expect(optionsEnv.vercel_env).toBe('production');
      expect(optionsEnv.vercel_region).toBe('iad1');
      expect(optionsEnv.vercel_commit_sha).toBe('abc1234def5678');
      expect(optionsEnv.environment_name).toBe('production');

      const eventId = TraceX.captureException(new Error('Vercel production crash'));
      expect(eventId).toBeDefined();

      await TraceX.flush();

      expect(transport.payloads.length).toBe(1);
      const payload = transport.payloads[0];
      const payloadEnv = payload.environment as any;

      expect(payloadEnv.vercel_env).toBe('production');
      expect(payloadEnv.vercel_region).toBe('iad1');
      expect(payloadEnv.vercel_commit_sha).toBe('abc1234def5678');
      expect(payloadEnv.environment_name).toBe('production');
    });

    it('allows disabling autoDetectVercel if explicitly opted out', async () => {
      process.env.VERCEL_ENV = 'production';
      process.env.VERCEL_REGION = 'iad1';
      process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234';

      const client = TraceX.init({
        projectKey: 'tracex_test_no_vercel_0123456789',
        transport,
        autoDetectVercel: false,
        instrumentHttp: false,
        captureUncaughtExceptions: false,
        captureUnhandledRejections: false,
        instrumentLifecycle: false,
      });

      const optionsEnv = client.getOptions().environment as any;
      expect(optionsEnv.vercel_env).toBeUndefined();
      expect(optionsEnv.vercel_region).toBeUndefined();
    });
  });
});
