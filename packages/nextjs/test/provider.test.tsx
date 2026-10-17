import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { CrashEventPayload, ITransport, TransportResponse } from '@tracex/core';
import { TraceX, TraceXReactClient } from '@tracex/react';
import { TraceXClientProvider } from '../src/client/provider';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

const ThrowingComponent: React.FC<{ message?: string; shouldThrow?: boolean }> = ({
  message = 'Explosive component boom',
  shouldThrow = true,
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div data-testid="child-ok">Normal Child Component</div>;
};

describe('<TraceXClientProvider>', () => {
  let win: GlobalWindow;
  let container: any;
  let root: Root;
  let transport: MockTransport;
  let client: TraceXReactClient;
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

    transport = new MockTransport();
    TraceX.reset();
    client = TraceX.init({
      projectKey: 'tracex_test_provider_0123456789',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    container = win.document.createElement('div');
    win.document.body.appendChild(container);
    root = createRoot(container as any);

    originalConsoleError = console.error;
    console.error = () => {}; // Silence expected React ErrorBoundary console logs
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    root.unmount();
    container.remove();
    await TraceX.close(100);
    TraceX.reset();
  });

  it('renders children normally when no error occurs and records zero telemetry', async () => {
    root.render(
      <TraceXClientProvider client={client}>
        <ThrowingComponent shouldThrow={false} />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Normal Child Component');
    expect(transport.payloads.length).toBe(0);
  });

  it('catches client component render error, displays default fallback UI, and captures crash telemetry', async () => {
    root.render(
      <TraceXClientProvider client={client}>
        <ThrowingComponent shouldThrow={true} message="Crash in root layout" />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    // Verifies fallback UI is rendered
    expect(container.innerHTML).toContain('Application Error');
    expect(container.innerHTML).toContain('Crash in root layout');
    expect(container.innerHTML).toContain('Reference ID:');
    expect(container.innerHTML).toContain('Try again');

    // Verifies crash telemetry captured
    expect(transport.payloads.length).toBe(1);
    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Crash in root layout');
    expect(payload.environment.mechanism).toBe('react.error_boundary');
  });

  it('resets error boundary and re-renders children when Try again button is clicked in DefaultErrorFallback', async () => {
    let shouldThrow = true;
    const DynamicComponent = () => {
      if (shouldThrow) {
        throw new Error('Temporary glitch');
      }
      return <div data-testid="recovered">Recovered Successfully</div>;
    };

    root.render(
      <TraceXClientProvider client={client}>
        <DynamicComponent />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Application Error');
    expect(container.innerHTML).toContain('Temporary glitch');

    // Fix the underlying issue
    shouldThrow = false;

    // Find and click the "Try again" button
    const retryBtn = Array.from(container.querySelectorAll('button')).find(
      (b: any) => b.textContent === 'Try again'
    ) as any;
    expect(retryBtn).toBeDefined();

    retryBtn.dispatchEvent(new win.Event('click', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Recovered Successfully');
    expect(container.innerHTML).not.toContain('Application Error');
  });

  it('renders custom static fallback UI when fallback prop is provided', async () => {
    root.render(
      <TraceXClientProvider
        client={client}
        fallback={<div data-testid="custom-fallback">Custom Error Screen</div>}
      >
        <ThrowingComponent shouldThrow={true} />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Custom Error Screen');
    expect(container.innerHTML).not.toContain('Application Error');
    expect(transport.payloads.length).toBe(1);
  });

  it('renders custom render-prop fallback passing error, eventId, and reset handler', async () => {
    root.render(
      <TraceXClientProvider
        client={client}
        fallback={({ error, eventId, reset }) => (
          <div data-testid="render-prop-fallback">
            <span>Trapped: {error.message}</span>
            <span>ID: {eventId}</span>
            <button onClick={reset}>Reset Now</button>
          </div>
        )}
      >
        <ThrowingComponent shouldThrow={true} message="Render prop bomb" />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Trapped: Render prop bomb');
    expect(container.innerHTML).toContain('ID: evt_');
    expect(container.innerHTML).toContain('Reset Now');
  });

  it('automatically initializes TraceX singleton when options prop is passed without existing client', async () => {
    TraceX.reset();
    expect(TraceX.getClient()).toBeUndefined();

    root.render(
      <TraceXClientProvider
        options={{
          projectKey: 'tracex_test_auto_init_0123456789',
          transport,
          instrumentClicks: false,
          instrumentNavigation: false,
          instrumentErrors: false,
        }}
      >
        <ThrowingComponent shouldThrow={false} />
      </TraceXClientProvider>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(TraceX.getClient()).toBeDefined();
    expect(TraceX.getClient()?.getOptions().projectKey).toBe(
      'tracex_test_auto_init_0123456789'
    );
    expect(container.innerHTML).toContain('Normal Child Component');
  });

  it('resets error state when resetKeys change', async () => {
    const TestHost = () => {
      const [key, setKey] = useState(1);
      const [shouldThrow, setShouldThrow] = useState(true);

      return (
        <div>
          <button
            data-testid="fix-and-reset"
            onClick={() => {
              setShouldThrow(false);
              setKey((k) => k + 1);
            }}
          >
            Fix
          </button>
          <TraceXClientProvider client={client} resetKeys={[key]}>
            <ThrowingComponent shouldThrow={shouldThrow} message="Key reset error" />
          </TraceXClientProvider>
        </div>
      );
    };

    root.render(<TestHost />);
    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Application Error');

    // Trigger key change
    const button = container.querySelector('button[data-testid="fix-and-reset"]');
    button.dispatchEvent(new win.Event('click', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 50));

    expect(container.innerHTML).toContain('Normal Child Component');
    expect(container.innerHTML).not.toContain('Application Error');
  });
});
