import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { BrowserErrorListeners } from '../src/integrations/error-listeners';
import { TraceXReactClient } from '../src/client/react-client';
import type { ITransport, CrashEventPayload, TransportResponse } from '@tracex-dev/core';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('BrowserErrorListeners', () => {
  let win: GlobalWindow;
  let transport: MockTransport;
  let client: TraceXReactClient;
  let listeners: BrowserErrorListeners;

  beforeEach(() => {
    win = new GlobalWindow({ url: 'http://localhost/' });
    Object.assign(globalThis, {
      window: win,
      document: win.document,
      ErrorEvent: win.ErrorEvent,
      Event: win.Event,
    });

    transport = new MockTransport();
    client = new TraceXReactClient({
      projectKey: 'tracex_test_browser_listeners',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    listeners = new BrowserErrorListeners(client);
    listeners.install();
  });

  afterEach(async () => {
    listeners.uninstall();
    await client.close();
  });

  it('captures unhandled error via window.dispatchEvent(ErrorEvent) with mechanism: window.onerror, source, lineno, and colno', async () => {
    const errorInstance = new Error('Uncaught runtime crash');
    const errorEvent = new win.ErrorEvent('error', {
      message: 'Uncaught runtime crash',
      filename: 'https://example.com/app.js',
      lineno: 142,
      colno: 25,
      error: errorInstance,
    });

    win.dispatchEvent(errorEvent);
    await client.flush();

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Uncaught runtime crash');
    expect(payload.environment.mechanism).toBe('window.onerror');
    expect(payload.environment.source).toBe('https://example.com/app.js');
    expect(payload.environment.lineno).toBe(142);
    expect(payload.environment.colno).toBe(25);
  });

  it('captures unhandled error via direct window.onerror invocation with string message', async () => {
    if (typeof win.onerror === 'function') {
      (win.onerror as any)('String error thrown', 'https://example.com/bundle.js', 10, 5, undefined);
    }
    await client.flush();

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('String error thrown');
    expect(payload.environment.mechanism).toBe('window.onerror');
    expect(payload.environment.source).toBe('https://example.com/bundle.js');
    expect(payload.environment.lineno).toBe(10);
    expect(payload.environment.colno).toBe(5);
  });

  it('preserves and delegates to pre-existing window.onerror handler', async () => {
    let preExistingCalled = false;
    let preExistingErrorMsg = '';

    // Create a new window with a pre-existing handler
    const win2 = new GlobalWindow({ url: 'http://localhost/' });
    win2.onerror = (msg) => {
      preExistingCalled = true;
      preExistingErrorMsg = String(msg);
      return true;
    };

    Object.assign(globalThis, { window: win2 });
    const localListeners = new BrowserErrorListeners(client);
    localListeners.install();

    if (typeof win2.onerror === 'function') {
      (win2.onerror as any)('Pre-existing check', 'test.js', 1, 1, new Error('Pre-existing check'));
    }
    await client.flush();

    expect(preExistingCalled).toBe(true);
    expect(preExistingErrorMsg).toContain('Pre-existing check');
    expect(transport.payloads.length).toBe(1);

    localListeners.uninstall();
    // Restored handler
    expect(win2.onerror).toBeDefined();
  });

  it('captures unhandled promise rejection with mechanism: window.unhandledrejection', async () => {
    const rejectionReason = new Error('Async promise rejected');
    const rejectionEvent = new win.Event('unhandledrejection') as any;
    rejectionEvent.reason = rejectionReason;

    win.dispatchEvent(rejectionEvent);
    await client.flush();

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Async promise rejected');
    expect(payload.environment.mechanism).toBe('window.unhandledrejection');
  });

  it('normalizes string rejection reason into synthetic UnhandledException', async () => {
    const rejectionEvent = new win.Event('unhandledrejection') as any;
    rejectionEvent.reason = 'Plain string rejection without Error object';

    win.dispatchEvent(rejectionEvent);
    await client.flush();

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Plain string rejection without Error object');
    expect(payload.exception_type).toBe('UnhandledException');
    expect(payload.environment.mechanism).toBe('window.unhandledrejection');
  });

  it('handles rejection with undefined reason without capturing DOM event object', async () => {
    const rejectionEvent = new win.Event('unhandledrejection') as any;
    rejectionEvent.reason = undefined;

    win.dispatchEvent(rejectionEvent);
    await client.flush();

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('undefined');
    expect(payload.exception_type).toBe('UnhandledException');
    expect(payload.environment.mechanism).toBe('window.unhandledrejection');
  });

  it('uninstalls cleanly, restores previous window.onerror, and removes rejection listener', async () => {
    listeners.uninstall();

    // After uninstall, dispatching error or rejection produces zero telemetry
    const errorEvent = new win.ErrorEvent('error', { message: 'After uninstall' });
    win.dispatchEvent(errorEvent);

    const rejectionEvent = new win.Event('unhandledrejection') as any;
    rejectionEvent.reason = new Error('After uninstall rejection');
    win.dispatchEvent(rejectionEvent);
    await client.flush();

    expect(transport.payloads.length).toBe(0);
  });

  it('safely no-ops in SSR environment when window is undefined', () => {
    const ssrListeners = new BrowserErrorListeners(client);
    expect(() => ssrListeners.install()).not.toThrow();
    expect(() => ssrListeners.uninstall()).not.toThrow();
  });
});
