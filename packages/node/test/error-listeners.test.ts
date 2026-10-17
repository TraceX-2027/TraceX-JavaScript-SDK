import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CrashEventPayload, TraceXClient } from '@tracex/core';
import { ServerRuntimeListener } from '../src/integrations/error-listeners';

describe('ServerRuntimeListener', () => {
  let capturedPayloads: CrashEventPayload[] = [];
  let exitCalls: number[] = [];
  let client: TraceXClient;
  let listener: ServerRuntimeListener | undefined;

  beforeEach(() => {
    capturedPayloads = [];
    exitCalls = [];

    client = new TraceXClient({
      projectKey: 'tracex_test_runtime_listeners',
      beforeSend: (payload) => {
        capturedPayloads.push(payload);
        return payload;
      },
    });
  });

  afterEach(() => {
    listener?.uninstall();
  });

  it('captures uncaughtException, flushes queue, and calls exitFn with code 1 by default', async () => {
    let exitResolved: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolved = resolve;
    });

    // Note: exitOnUncaughtException omitted so default (true) is tested
    listener = new ServerRuntimeListener(client, {
      projectKey: 'tracex_test_runtime_listeners',
      uncaughtExceptionTimeoutMs: 1000,
      exitFn: (code) => {
        exitCalls.push(code);
        exitResolved(code);
      },
    });
    listener.install();

    const fatalError = new Error('Fatal boom');
    process.emit('uncaughtException', fatalError);

    const code = await exitPromise;
    expect(code).toBe(1);
    expect(exitCalls).toEqual([1]);

    expect(capturedPayloads.length).toBe(1);
    expect(capturedPayloads[0].error_message).toBe('Fatal boom');
    expect(capturedPayloads[0].environment.mechanism).toBe('uncaughtException');
  });

  it('captures uncaughtException without calling exitFn when exitOnUncaughtException is false', async () => {
    listener = new ServerRuntimeListener(client, {
      projectKey: 'tracex_test_runtime_listeners',
      exitOnUncaughtException: false,
      exitFn: (code) => {
        exitCalls.push(code);
      },
    });
    listener.install();

    const fatalError = new Error('Non-fatal crash');
    process.emit('uncaughtException', fatalError);

    // Give microtasks time to run flush
    await Bun.sleep(20);

    expect(exitCalls.length).toBe(0);
    expect(capturedPayloads.length).toBe(1);
    expect(capturedPayloads[0].error_message).toBe('Non-fatal crash');
    expect(capturedPayloads[0].environment.mechanism).toBe('uncaughtException');
  });

  it('captures unhandledRejection without calling exitFn and normalizes rejection reason', async () => {
    listener = new ServerRuntimeListener(client, {
      projectKey: 'tracex_test_runtime_listeners',
      exitFn: (code) => {
        exitCalls.push(code);
      },
    });
    listener.install();

    process.emit('unhandledRejection', 'Unhandled reject reason', Promise.resolve());

    await Bun.sleep(20);

    expect(exitCalls.length).toBe(0);
    expect(capturedPayloads.length).toBe(1);
    expect(capturedPayloads[0].error_message).toBe('Unhandled reject reason');
    expect(capturedPayloads[0].environment.mechanism).toBe('unhandledRejection');
  });

  it('uninstalls cleanly and removes process listeners without affecting existing ones', async () => {
    let dummyCalled = false;
    const dummyListener = () => {
      dummyCalled = true;
    };
    process.on('uncaughtException', dummyListener);

    const initialRejectionListeners = process.listeners('unhandledRejection').length;

    listener = new ServerRuntimeListener(client, {
      projectKey: 'tracex_test_runtime_listeners',
      exitOnUncaughtException: false,
    });
    listener.install();

    expect(process.listeners('unhandledRejection').length).toBe(
      initialRejectionListeners + 1
    );

    listener.uninstall();

    // Verify unhandledRejection listeners cleaned up
    expect(process.listeners('unhandledRejection').length).toBe(
      initialRejectionListeners
    );

    // Verify dummyListener is still present
    const listeners = process.listeners('uncaughtException');
    expect(listeners).toContain(dummyListener);

    process.emit('uncaughtException', new Error('Ignored by uninstalled listener'));
    expect(dummyCalled).toBe(true);

    process.removeListener('uncaughtException', dummyListener);
  });
});
