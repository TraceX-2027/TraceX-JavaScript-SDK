import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TraceX, TraceXReactClient, TraceXProvider, useTraceX } from '../src/index';
import type { ITransport, CrashEventPayload, TransportResponse } from '@tracex/core';

class MockTransport implements ITransport {
  public payloads: CrashEventPayload[] = [];
  async send(_url: string, _projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    this.payloads.push(payload);
    return { status: 200 };
  }
}

describe('TraceXReactClient & TraceX Facade', () => {
  let win: GlobalWindow;
  let transport: MockTransport;

  beforeEach(() => {
    win = new GlobalWindow({ url: 'http://localhost/app/home?tab=1#overview' });
    Object.assign(globalThis, {
      window: win,
      document: win.document,
      navigator: win.navigator,
      location: win.location,
      history: win.history,
      screen: win.screen,
      HTMLElement: win.HTMLElement,
      HTMLInputElement: win.HTMLInputElement,
      MouseEvent: win.MouseEvent,
      ErrorEvent: win.ErrorEvent,
      Event: win.Event,
    });

    transport = new MockTransport();
  });

  afterEach(async () => {
    await TraceX.close();
    TraceX.reset();
  });

  describe('Initialization & Configuration', () => {
    it('initializes TraceXReactClient with defaults and singleton pattern', () => {
      const client = TraceX.init({
        projectKey: 'tracex_live_frontend_test',
        transport,
      });

      expect(client).toBeInstanceOf(TraceXReactClient);
      expect(TraceX.getClient()).toBe(client);
      expect(client.getErrorListeners()).toBeDefined();
      expect(client.getDomTracker()).toBeDefined();
      expect(client.getNavigationTracker()).toBeDefined();
    });

    it('throws error when projectKey is invalid or missing', () => {
      expect(() => {
        TraceX.init({ projectKey: 'invalid_key' });
      }).toThrow("Invalid projectKey: must start with 'tracex_live_' or 'tracex_test_'");

      expect(() => {
        TraceX.init({ projectKey: '' });
      }).toThrow();
    });

    it('respects configuration flags disabling click, navigation, or error listeners', () => {
      const client = TraceX.init({
        projectKey: 'tracex_test_flags',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      expect(client.getErrorListeners()).toBeUndefined();
      expect(client.getDomTracker()).toBeUndefined();
      expect(client.getNavigationTracker()).toBeUndefined();
    });

    it('falls back environment_name to development when omitted', () => {
      const client = TraceX.init({
        projectKey: 'tracex_test_env_fallback',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      const env = client.getOptions().environment as any;
      expect(env.environment_name).toBe('development');
    });
  });

  describe('Client Forensics & Context Enrichment', () => {
    it('enriches captured exceptions with browser and React runtime forensics', async () => {
      // Configure mock window dimensions
      Object.defineProperty(win, 'innerWidth', { value: 1440, configurable: true });
      Object.defineProperty(win, 'innerHeight', { value: 900, configurable: true });
      Object.defineProperty(win, 'screen', { value: { width: 1920, height: 1080 }, configurable: true });
      Object.defineProperty(globalThis, 'innerWidth', { value: 1440, configurable: true });
      Object.defineProperty(globalThis, 'innerHeight', { value: 900, configurable: true });
      Object.defineProperty(globalThis, 'screen', { value: { width: 1920, height: 1080 }, configurable: true });

      const client = TraceX.init({
        projectKey: 'tracex_test_forensics',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      TraceX.captureException(new Error('Forensics test error'));
      await client.flush();

      expect(transport.payloads.length).toBe(1);
      const payload = transport.payloads[0];

      expect(payload.platform).toBe('browser');
      expect(payload.environment.runtime).toBe('react');
      expect(payload.environment.runtime_version).toBe(React.version);
      expect(payload.environment.viewport_width).toBe(1440);
      expect(payload.environment.viewport_height).toBe(900);
      expect(payload.environment.screen_resolution).toBe('1920x1080');
      expect(payload.environment.current_url).toBe('http://localhost/app/home?tab=1#overview');
      expect(payload.environment.is_online).toBe(true);
    });

    it('merges ad-hoc context with live browser forensics', async () => {
      const client = TraceX.init({
        projectKey: 'tracex_test_context_merge',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      TraceX.captureException(new Error('Merged context error'), {
        custom_tag: 'user_settings',
        user_id: 12345,
      });
      await client.flush();

      expect(transport.payloads.length).toBe(1);
      const payload = transport.payloads[0];
      expect(payload.environment.custom_tag).toBe('user_settings');
      expect(payload.environment.user_id).toBe(12345);
      expect(payload.environment.runtime).toBe('react');
    });
  });

  describe('TraceXProvider & useTraceX Hook', () => {
    it('provides client instance to useTraceX hook inside TraceXProvider', async () => {
      const client = new TraceXReactClient({
        projectKey: 'tracex_test_hook',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      let hookClient: TraceXReactClient | undefined;

      const ConsumerComponent = () => {
        hookClient = useTraceX();
        return React.createElement('div', null, 'Consumer');
      };

      const container = win.document.createElement('div');
      const root = createRoot(container as any);

      root.render(
        React.createElement(
          TraceXProvider,
          { client },
          React.createElement(ConsumerComponent)
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hookClient).toBe(client);

      root.unmount();
      await client.close();
    });

    it('falls back to global singleton when TraceXProvider client prop is omitted', async () => {
      const globalClient = TraceX.init({
        projectKey: 'tracex_test_global_provider',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      let hookClient: TraceXReactClient | undefined;

      const ConsumerComponent = () => {
        hookClient = useTraceX();
        return React.createElement('div', null, 'Consumer');
      };

      const container = win.document.createElement('div');
      const root = createRoot(container as any);

      root.render(
        React.createElement(
          TraceXProvider,
          null,
          React.createElement(ConsumerComponent)
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hookClient).toBe(globalClient);

      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('Server-Side Rendering (SSR) Safety', () => {
    it('safely evaluates TraceX.init() without throwing when window and document are undefined', async () => {
      const savedWindow = (globalThis as any).window;
      const savedDocument = (globalThis as any).document;

      try {
        delete (globalThis as any).window;
        delete (globalThis as any).document;

        const ssrClient = TraceX.init({
          projectKey: 'tracex_test_ssr',
          transport,
        });

        expect(ssrClient).toBeDefined();
        expect(ssrClient.getErrorListeners()).toBeUndefined();
        expect(ssrClient.getDomTracker()).toBeUndefined();
        expect(ssrClient.getNavigationTracker()).toBeUndefined();

        // Capture exception during SSR
        TraceX.captureException(new Error('SSR Server Crash'));
        await ssrClient.flush();

        expect(transport.payloads.length).toBe(1);
        expect(transport.payloads[0].error_message).toBe('SSR Server Crash');
      } finally {
        (globalThis as any).window = savedWindow;
        (globalThis as any).document = savedDocument;
      }
    });
  });

  describe('Teardown & Lifecycle', () => {
    it('restores patched globals and unregisters listeners when closed', async () => {
      const origPush = win.history.pushState;
      const origOnError = win.onerror;

      const client = TraceX.init({
        projectKey: 'tracex_test_teardown',
        transport,
      });

      expect(win.history.pushState).not.toBe(origPush);

      await TraceX.close();

      expect(TraceX.getClient()).toBeUndefined();
      expect(win.history.pushState).toBe(origPush);
      expect(win.onerror).toBe(origOnError);
    });

    it('resolves active client when useTraceX() is used outside TraceXProvider', async () => {
      const globalClient = TraceX.init({
        projectKey: 'tracex_test_outside_provider',
        transport,
        instrumentClicks: false,
        instrumentNavigation: false,
        instrumentErrors: false,
      });

      let hookClient: TraceXReactClient | undefined;

      const BareComponent = () => {
        hookClient = useTraceX();
        return React.createElement('div', null, 'Bare');
      };

      const container = win.document.createElement('div');
      const root = createRoot(container as any);
      root.render(React.createElement(BareComponent));

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hookClient).toBe(globalClient);
      root.unmount();
    });

    it('facade methods are safe and non-blocking when client not initialized', async () => {
      TraceX.reset();

      expect(TraceX.getClient()).toBeUndefined();
      expect(() => TraceX.captureException(new Error('No crash'))).not.toThrow();
      expect(() => TraceX.addBreadcrumb({ category: 'ui', action: 'tap', target: 'button' })).not.toThrow();
      expect(await TraceX.flush()).toBe(true);
      expect(await TraceX.close()).toBe(true);
    });
  });
});
