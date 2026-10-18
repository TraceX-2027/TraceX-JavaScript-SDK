import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  TraceXErrorBoundary,
  withTraceXErrorBoundary,
} from '../src/components/error-boundary';
import { TraceXProvider } from '../src/context/tracex-context';
import { TraceXReactClient } from '../src/client/react-client';
import { TraceX } from '../src/index';
import type { ITransport, CrashEventPayload, TransportResponse } from '@tracex-dev/core';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('TraceXErrorBoundary Component & HOC', () => {
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
    client = new TraceXReactClient({
      projectKey: 'tracex_test_boundary1',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    container = win.document.createElement('div');
    win.document.body.appendChild(container);
    root = createRoot(container as any);

    originalConsoleError = console.error;
    console.error = () => {};
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    root.unmount();
    container.remove();
    await client.close();
    TraceX.reset();
  });

  const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

  it('renders children normally when no error occurs and records zero telemetry', async () => {
    const SafeComponent = () => <span>Safe Content</span>;

    root.render(
      <TraceXErrorBoundary client={client} fallback={<div>Error</div>}>
        <SafeComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('Safe Content');
    expect(transport.payloads.length).toBe(0);
  });

  it('catches render error, renders static fallback, and captures telemetry with mechanism: react.error_boundary and componentStack', async () => {
    const FailingComponent = () => {
      throw new Error('Component crashed during render');
    };

    root.render(
      <TraceXErrorBoundary client={client} fallback={<div id="error-fallback">UI Error</div>}>
        <FailingComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('UI Error');
    expect(transport.payloads.length).toBe(1);

    const payload = transport.payloads[0];
    expect(payload.error_message).toBe('Component crashed during render');
    expect(payload.environment.mechanism).toBe('react.error_boundary');
    expect(typeof payload.environment.componentStack).toBe('string');
    expect(payload.environment.componentStack).toContain('FailingComponent');
  });

  it('supports render-prop fallback passing error, componentStack, eventId, and reset()', async () => {
    const FailingComponent = () => {
      throw new Error('Render-prop error');
    };

    root.render(
      <TraceXErrorBoundary
        client={client}
        fallback={({ error, componentStack, eventId, reset }) => (
          <div>
            <span id="err-msg">{error.message}</span>
            <span id="has-stack">{componentStack ? 'yes-stack' : 'no-stack'}</span>
            <span id="evt-id">{eventId}</span>
            <button id="reset-btn" onClick={reset}>
              Try Again
            </button>
          </div>
        )}
      >
        <FailingComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('Render-prop error');
    expect(container.innerHTML).toContain('yes-stack');
    expect(transport.payloads.length).toBe(1);
    expect(container.innerHTML).toContain(transport.payloads[0].event_id!);
  });

  it('invoking reset() clears error state and attempts re-rendering children', async () => {
    let shouldFail = true;
    const ConditionalComponent = () => {
      if (shouldFail) {
        throw new Error('Transient error');
      }
      return <div id="success">Recovered Successfully</div>;
    };

    let resetFn: () => void = () => {};

    root.render(
      <TraceXErrorBoundary
        client={client}
        fallback={({ reset }) => {
          resetFn = reset;
          return <button onClick={reset}>Retry</button>;
        }}
      >
        <ConditionalComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('Retry');
    expect(transport.payloads.length).toBe(1);

    // Fix component condition and trigger reset
    shouldFail = false;
    resetFn();

    await wait();
    expect(container.innerHTML).toContain('Recovered Successfully');
  });

  it('automatically resets error boundary when resetKeys change using Object.is comparison', async () => {
    const DynamicComponent = ({ tab }: { tab: number }) => {
      if (tab === 1) {
        throw new Error('Tab 1 crashed');
      }
      return <div>Active Tab: {tab}</div>;
    };

    const App = () => {
      const [tab, setTab] = useState(1);
      return (
        <div>
          <button id="switch-tab" onClick={() => setTab(2)}>
            Switch
          </button>
          <TraceXErrorBoundary client={client} resetKeys={[tab]} fallback={<div>Tab Error</div>}>
            <DynamicComponent tab={tab} />
          </TraceXErrorBoundary>
        </div>
      );
    };

    root.render(<App />);
    await wait();
    expect(container.innerHTML).toContain('Tab Error');

    // Click switch tab button to change resetKeys from [1] to [2]
    const btn = container.querySelector('#switch-tab') as HTMLButtonElement;
    btn.click();

    await wait();
    expect(container.innerHTML).toContain('Active Tab: 2');
  });

  it('invokes onError callback with error and componentStack info', async () => {
    let receivedError: any = null;
    let receivedStack: any = null;
    let receivedEventId: any = undefined;

    const FailingComponent = () => {
      throw new Error('Callback verification');
    };

    root.render(
      <TraceXErrorBoundary
        client={client}
        onError={(err, info) => {
          receivedError = err;
          receivedStack = info.componentStack;
          receivedEventId = info.eventId;
        }}
        fallback={<div>Fallback</div>}
      >
        <FailingComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(receivedError).not.toBeNull();
    expect(receivedError?.message).toBe('Callback verification');
    expect(receivedStack).toContain('FailingComponent');
    expect(receivedEventId).toBe(transport.payloads[0].event_id);
  });

  it('invokes onReset callback when reset is triggered', async () => {
    let onResetCalled = false;
    let shouldFail = true;

    const FlakyComponent = () => {
      if (shouldFail) {
        throw new Error('Fail');
      }
      return <div>OK</div>;
    };

    let resetHandler: () => void = () => {};

    root.render(
      <TraceXErrorBoundary
        client={client}
        onReset={() => {
          onResetCalled = true;
        }}
        fallback={({ reset }) => {
          resetHandler = reset;
          return <button onClick={reset}>Reset</button>;
        }}
      >
        <FlakyComponent />
      </TraceXErrorBoundary>
    );

    await wait();
    shouldFail = false;
    resetHandler();

    await wait();
    expect(onResetCalled).toBe(true);
    expect(container.innerHTML).toContain('OK');
  });

  it('withTraceXErrorBoundary HOC wraps component, sets displayName, and catches errors', async () => {
    const RawComponent: React.FC<{ shouldCrash?: boolean }> = ({ shouldCrash }) => {
      if (shouldCrash) {
        throw new Error('HOC failure');
      }
      return <div>HOC child ok</div>;
    };
    RawComponent.displayName = 'MyRawComponent';

    const ProtectedComponent = withTraceXErrorBoundary(RawComponent, {
      client,
      fallback: <div>HOC fallback active</div>,
    });

    expect(ProtectedComponent.displayName).toBe('withTraceXErrorBoundary(MyRawComponent)');

    // 1. Renders cleanly when no error
    root.render(<ProtectedComponent shouldCrash={false} />);
    await wait();
    expect(container.innerHTML).toContain('HOC child ok');

    // 2. Traps error and renders fallback
    root.render(<ProtectedComponent shouldCrash={true} />);
    await wait();
    expect(container.innerHTML).toContain('HOC fallback active');
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].error_message).toBe('HOC failure');
  });

  it('inherits client from TraceXProvider context if no client prop is passed', async () => {
    const Failing = () => {
      throw new Error('Context error');
    };

    root.render(
      <TraceXProvider client={client}>
        <TraceXErrorBoundary fallback={<div>Context Fallback</div>}>
          <Failing />
        </TraceXErrorBoundary>
      </TraceXProvider>
    );

    await wait();
    expect(container.innerHTML).toContain('Context Fallback');
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].error_message).toBe('Context error');
  });

  it('falls back to TraceX.getClient() singleton when client prop and TraceXProvider are omitted', async () => {
    TraceX.init({
      projectKey: 'tracex_test_singleton_boundary',
      transport,
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    const Failing = () => {
      throw new Error('Singleton boundary error');
    };

    root.render(
      <TraceXErrorBoundary fallback={<div>Singleton Fallback</div>}>
        <Failing />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('Singleton Fallback');
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].error_message).toBe('Singleton boundary error');
  });

  it('normalizes non-Error throwables into Error instances', async () => {
    const FailingString = () => {
      throw 'Raw string exception thrown';
    };

    let receivedError: any = null;

    root.render(
      <TraceXErrorBoundary
        client={client}
        fallback={({ error }) => {
          receivedError = error;
          return <div>String Fallback: {error.message}</div>;
        }}
      >
        <FailingString />
      </TraceXErrorBoundary>
    );

    await wait();
    expect(container.innerHTML).toContain('String Fallback: Raw string exception thrown');
    expect(receivedError).toBeInstanceOf(Error);
    expect(receivedError?.message).toBe('Raw string exception thrown');
    expect(transport.payloads.length).toBe(1);
    expect(transport.payloads[0].error_message).toBe('Raw string exception thrown');
  });

  it('renders children directly during SSR without throwing', () => {
    // Simulate SSR by invoking TraceXErrorBoundary when window is undefined
    const boundary = new TraceXErrorBoundary({
      children: 'SSR content',
      fallback: 'Fallback',
    });

    const rendered = boundary.render();
    expect(rendered).toBe('SSR content');
  });
});
