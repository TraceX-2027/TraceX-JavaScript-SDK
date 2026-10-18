import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex-dev/core';
import { withTraceXServerAction } from '../src/server/server-action';
import { TraceX } from '../src/server/tracex-server';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('withTraceXServerAction', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
    TraceX.reset();
    TraceX.init({
      projectKey: 'tracex_test_server_actions_0123456789',
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

  it('executes server action successfully and logs action.server breadcrumb with duration', async () => {
    const action = withTraceXServerAction('updateProfile', async (data: { name: string; age: number }) => {
      return { ok: true, profile: data };
    });

    const result = await action({ name: 'Alice', age: 30 });
    expect(result).toEqual({ ok: true, profile: { name: 'Alice', age: 30 } });

    // Verify breadcrumb in ring buffer via captureException
    const testErrEventId = TraceX.captureException(new Error('Checkpoint'));
    expect(testErrEventId).toBeDefined();
    await TraceX.flush();
    expect(transport.payloads.length).toBe(1);

    const payload = transport.payloads[0];
    const breadcrumb = payload.breadcrumbs.find((b) => b.category === 'action.server');
    expect(breadcrumb).toBeDefined();
    expect(breadcrumb?.action).toBe('updateProfile');
    expect(breadcrumb?.data?.action_name).toBe('updateProfile');
    expect(typeof breadcrumb?.data?.duration_ms).toBe('number');
  });

  it('captures crash with mechanism nextjs.server_action, awaits flush, and rethrows original error', async () => {
    const originalError = new Error('Database connection failed');
    const action = withTraceXServerAction('fetchData', async () => {
      throw originalError;
    });

    let thrownError: unknown;
    try {
      await action();
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBe(originalError);
    expect(transport.payloads.length).toBe(1);

    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Database connection failed');
    expect(payload.environment.mechanism).toBe('nextjs.server_action');
    expect(payload.environment.action_name).toBe('fetchData');
    expect(typeof payload.environment.duration_ms).toBe('number');
  });

  it('scrubs sensitive object arguments (passwords, tokens, api keys) upon error capture', async () => {
    const action = withTraceXServerAction('authenticateUser', async (_payload: any) => {
      throw new Error('Invalid credentials');
    });

    await expect(
      action({
        username: 'alice@example.com',
        password: 'SuperSecretPassword123!',
        token: 'tok_live_999999',
        apiKey: 'key_abc123',
        nested: {
          clientSecret: 'shhh',
          normalField: 'visible',
        },
      })
    ).rejects.toThrow('Invalid credentials');

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    const scrubbedArgs = payload.environment.arguments as any[];

    expect(scrubbedArgs).toBeDefined();
    expect(Array.isArray(scrubbedArgs)).toBe(true);

    const firstArg = scrubbedArgs[0];
    expect(firstArg.username).toBe('alice@example.com');
    expect(firstArg.password).toBe('[REDACTED]');
    expect(firstArg.token).toBe('[REDACTED]');
    expect(firstArg.apiKey).toBe('[REDACTED]');
    expect(firstArg.nested.clientSecret).toBe('[REDACTED]');
    expect(firstArg.nested.normalField).toBe('visible');
  });

  it('scrubs sensitive FormData arguments containing passwords and auth tokens and formats File attachments', async () => {
    const action = withTraceXServerAction('submitFormAction', async (_formData: FormData) => {
      throw new Error('Form processing error');
    });

    const formData = new FormData();
    formData.append('username', 'bob_builder');
    formData.append('password', 'p@ssw0rd!');
    formData.append('token', 'session_tok_abc');
    formData.append('description', 'Public profile bio');
    formData.append('document', new File(['content'], 'document.pdf', { type: 'application/pdf' }));
    formData.append('tags', 'news');
    formData.append('tags', 'tech');

    await expect(action(formData)).rejects.toThrow('Form processing error');

    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    const scrubbedArgs = payload.environment.arguments as any[];

    expect(scrubbedArgs).toBeDefined();
    const scrubbedForm = scrubbedArgs[0];

    expect(scrubbedForm.username).toBe('bob_builder');
    expect(scrubbedForm.password).toBe('[REDACTED]');
    expect(scrubbedForm.token).toBe('[REDACTED]');
    expect(scrubbedForm.description).toBe('Public profile bio');
    expect(scrubbedForm.document).toBe('[File: document.pdf]');
    expect(scrubbedForm.tags).toEqual(['news', 'tech']);
  });

  it('rethrows Next.js redirect control flow exceptions without capturing telemetry', async () => {
    const redirectError = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    redirectError.digest = 'NEXT_REDIRECT;replace;/profile;307;';

    const action = withTraceXServerAction('redirectAction', async () => {
      throw redirectError;
    });

    await expect(action()).rejects.toThrow('NEXT_REDIRECT');
    expect(transport.payloads.length).toBe(0);
  });

  it('rethrows Next.js notFound control flow exceptions without capturing telemetry', async () => {
    const notFoundError = new Error('NEXT_NOT_FOUND') as Error & { digest?: string };
    notFoundError.digest = 'NEXT_NOT_FOUND';

    const action = withTraceXServerAction('notFoundAction', async () => {
      throw notFoundError;
    });

    await expect(action()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(transport.payloads.length).toBe(0);
  });

  it('handles non-Error throwables and still rethrows original value', async () => {
    const action = withTraceXServerAction('rawStringAction', async () => {
      throw 'A string failure happened';
    });

    let caught: unknown;
    try {
      await action();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe('A string failure happened');
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].environment.mechanism).toBe('nextjs.server_action');
  });

  it('does not swallow original error even if telemetry dispatch throws', async () => {
    const origSend = transport.send;
    try {
      transport.send = async () => {
        throw new Error('Telemetry network crashed');
      };

      const action = withTraceXServerAction('resilientAction', async () => {
        throw new Error('Original business error');
      });

      await expect(action()).rejects.toThrow('Original business error');
    } finally {
      transport.send = origSend;
    }
  });
});
