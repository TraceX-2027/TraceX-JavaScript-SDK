import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex/core';
import { TraceXReactClient } from '@tracex/react';
import { TraceXServer } from '../src/server/tracex-server';
import {
  TraceX,
  init,
  getClient,
  captureException,
  addBreadcrumb,
  flush,
  close,
  reset,
  isBrowser,
  withTraceXServerAction,
  withTraceXRoute,
  VercelEnvironmentProvider,
  TraceXClientProvider,
  captureNextGlobalError,
} from '../src/index';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('Universal Isomorphic Barrel (index.ts)', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
    reset();
  });

  afterEach(async () => {
    await close(100);
    reset();
  });

  it('exports all expected server and client primitives', () => {
    expect(typeof withTraceXServerAction).toBe('function');
    expect(typeof withTraceXRoute).toBe('function');
    expect(typeof VercelEnvironmentProvider).toBe('function');
    expect(typeof TraceXClientProvider).toBe('function');
    expect(typeof captureNextGlobalError).toBe('function');
    expect(typeof isBrowser).toBe('function');
  });

  it('initializes server runtime client when window is undefined', async () => {
    const client = init({
      projectKey: 'tracex_test_barrel_01234567890123',
      transport,
      instrumentHttp: false,
      captureUncaughtExceptions: false,
      captureUnhandledRejections: false,
      instrumentLifecycle: false,
    });

    expect(client).toBeDefined();
    expect(getClient()).toBe(client);

    addBreadcrumb({
      category: 'action.server',
      action: 'barrelTest',
      target: 'barrelTest',
    });

    const eventId = captureException(new Error('Barrel crash'));
    expect(eventId).toBeDefined();

    await flush();

    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].event_id).toBe(eventId);
    expect(transport.payloads[0].error_message).toBe('Barrel crash');
  });

  it('TraceX static facade delegates properly to active client', async () => {
    TraceX.init({
      projectKey: 'tracex_test_facade_01234567890123',
      transport,
      instrumentHttp: false,
      captureUncaughtExceptions: false,
      captureUnhandledRejections: false,
      instrumentLifecycle: false,
    });

    expect(TraceX.getClient()).toBeDefined();

    TraceX.addBreadcrumb({
      category: 'system',
      action: 'ping',
      target: 'health',
    });

    const eventId = TraceX.captureException(new Error('Facade test error'));
    expect(eventId).toBeDefined();

    await TraceX.flush();

    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].event_id).toBe(eventId);
  });

  it('invalidates client singleton so TraceXServer.getClient() returns undefined after close()', async () => {
    TraceXServer.init({
      projectKey: 'tracex_test_server_close_0123456789',
      transport,
      instrumentHttp: false,
      captureUncaughtExceptions: false,
      captureUnhandledRejections: false,
      instrumentLifecycle: false,
    });

    expect(TraceXServer.getClient()).toBeDefined();
    await TraceXServer.close(100);
    expect(TraceXServer.getClient()).toBeUndefined();
  });

  it('initializes TraceXReactClient when browser globals window and document are defined', async () => {
    const win = new GlobalWindow({ url: 'http://localhost/' });
    (globalThis as any).window = win;
    (globalThis as any).document = win.document;

    try {
      expect(isBrowser()).toBe(true);

      const client = TraceX.init({
        projectKey: 'tracex_test_browser_iso_0123456789',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      expect(client).toBeInstanceOf(TraceXReactClient);
      expect(TraceX.getClient()).toBe(client);
    } finally {
      await TraceX.close(100);
      TraceX.reset();
      delete (globalThis as any).window;
      delete (globalThis as any).document;
    }
  });
});
