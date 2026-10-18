import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex-dev/core';
import { TraceX } from '@tracex-dev/react';
import { captureNextGlobalError } from '../src/client/global-error';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('captureNextGlobalError', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
    TraceX.reset();
  });

  afterEach(async () => {
    await TraceX.close(100);
    TraceX.reset();
  });

  it('captures crash with mechanism nextjs.global_error and extracts error.digest', async () => {
    TraceX.init({
      projectKey: 'tracex_test_global_error_0123456789',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    const error = new Error('Root layout hydration crash') as Error & { digest?: string };
    error.digest = '1482937582';

    const eventId = await captureNextGlobalError(error);

    expect(typeof eventId).toBe('string');
    expect(eventId.startsWith('evt_')).toBe(true);

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.event_id).toBe(eventId);
    expect(payload.error_message).toBe('Root layout hydration crash');
    expect(payload.environment.mechanism).toBe('nextjs.global_error');
    expect(payload.environment.digest).toBe('1482937582');
  });

  it('captures error without digest and returns eventId', async () => {
    TraceX.init({
      projectKey: 'tracex_test_global_error_0123456789',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    const error = new Error('Generic unhandled root crash');
    const eventId = await captureNextGlobalError(error);

    expect(typeof eventId).toBe('string');
    expect(eventId.startsWith('evt_')).toBe(true);

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.environment.mechanism).toBe('nextjs.global_error');
    expect(payload.environment.digest).toBeUndefined();
  });

  it('merges custom context into error payload', async () => {
    TraceX.init({
      projectKey: 'tracex_test_global_error_0123456789',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    const error = new Error('Custom context crash') as Error & { digest?: string };
    error.digest = 'digest_abc';

    const eventId = await captureNextGlobalError(error, {
      route: '/settings/billing',
      componentName: 'RootLayout',
    });

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.environment.mechanism).toBe('nextjs.global_error');
    expect(payload.environment.digest).toBe('digest_abc');
    expect(payload.environment.route).toBe('/settings/billing');
    expect(payload.environment.componentName).toBe('RootLayout');
  });

  it('handles non-Error throwables and returns eventId string', async () => {
    TraceX.init({
      projectKey: 'tracex_test_global_error_0123456789',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    const eventId = await captureNextGlobalError('Critical string throw in root');

    expect(typeof eventId).toBe('string');
    expect(eventId.startsWith('evt_')).toBe(true);
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].environment.mechanism).toBe('nextjs.global_error');
  });

  it('returns valid fallback eventId when TraceX is not initialized', async () => {
    // Client is NOT initialized
    const error = new Error('Crash before TraceX initialization');
    const eventId = await captureNextGlobalError(error);

    expect(typeof eventId).toBe('string');
    expect(eventId.startsWith('evt_')).toBe(true);
    expect(transport.payloads.length).toBe(0);
  });
});
