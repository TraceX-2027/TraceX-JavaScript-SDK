import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { NavigationTracker } from '../src/integrations/navigation-tracker';
import { TraceXReactClient } from '../src/client/react-client';
import { Breadcrumb } from '@tracex-dev/core';

describe('NavigationTracker', () => {
  let win: GlobalWindow;
  let client: TraceXReactClient;
  let tracker: NavigationTracker;

  beforeEach(() => {
    win = new GlobalWindow({ url: 'http://localhost/' });
    Object.assign(globalThis, {
      window: win,
      document: win.document,
      location: win.location,
      history: win.history,
      PopStateEvent: win.PopStateEvent,
      HashChangeEvent: win.HashChangeEvent,
      Event: win.Event,
    });

    client = new TraceXReactClient({
      projectKey: 'tracex_test_nav1',
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    tracker = new NavigationTracker(client);
    tracker.install();
  });

  afterEach(async () => {
    tracker.uninstall();
    await client.close();
  });

  const getBreadcrumbs = (): Breadcrumb[] => client.getRingBuffer().getItems();

  it('records navigation.route breadcrumb on history.pushState with from, to, and type', () => {
    win.history.pushState({ page: 1 }, '', '/dashboard');

    const breadcrumbs = getBreadcrumbs();
    expect(breadcrumbs.length).toBe(1);
    expect(breadcrumbs[0].category).toBe('navigation.route');
    expect(breadcrumbs[0].action).toBe('pushState');
    expect(breadcrumbs[0].target).toBe('/dashboard');
    expect(breadcrumbs[0].data?.from).toBe('/');
    expect(breadcrumbs[0].data?.to).toBe('/dashboard');
    expect(breadcrumbs[0].data?.type).toBe('pushState');
  });

  it('preserves native history behavior and arguments when calling pushState', () => {
    const stateObj = { user: 'alice' };
    win.history.pushState(stateObj, 'Title', '/profile');

    expect(win.history.state).toEqual(stateObj);
    expect(win.location.pathname).toBe('/profile');
  });

  it('records navigation.route breadcrumb on history.replaceState', () => {
    win.history.replaceState({ step: 2 }, '', '/checkout/step2');

    const breadcrumbs = getBreadcrumbs();
    expect(breadcrumbs.length).toBe(1);
    expect(breadcrumbs[0].category).toBe('navigation.route');
    expect(breadcrumbs[0].action).toBe('replaceState');
    expect(breadcrumbs[0].target).toBe('/checkout/step2');
    expect(breadcrumbs[0].data?.type).toBe('replaceState');
  });

  it('deduplicates consecutive redundant transitions with identical destination', () => {
    win.history.pushState({}, '', '/dashboard');
    win.history.pushState({}, '', '/dashboard');

    const breadcrumbs = getBreadcrumbs();
    expect(breadcrumbs.length).toBe(1);
  });

  it('records subsequent transition when navigating back to a previous URL non-consecutively', () => {
    win.history.pushState({}, '', '/page-a');
    win.history.pushState({}, '', '/page-b');
    win.history.pushState({}, '', '/page-a');

    const breadcrumbs = getBreadcrumbs();
    expect(breadcrumbs.length).toBe(3);
    expect(breadcrumbs[0].target).toBe('/page-a');
    expect(breadcrumbs[1].target).toBe('/page-b');
    expect(breadcrumbs[2].target).toBe('/page-a');
  });

  it('captures popstate event transitions', () => {
    win.history.pushState({}, '', '/first');
    // Simulate popstate transition
    win.location.pathname = '/back';
    win.dispatchEvent(new win.Event('popstate'));

    const breadcrumbs = getBreadcrumbs();
    const popstateCrumb = breadcrumbs.find((b) => b.action === 'popstate');
    expect(popstateCrumb).toBeDefined();
    expect(popstateCrumb?.category).toBe('navigation.route');
    expect(popstateCrumb?.data?.to).toBe('/back');
    expect(popstateCrumb?.data?.type).toBe('popstate');
  });

  it('captures hashchange event transitions', () => {
    const hashEvent = new win.Event('hashchange') as any;
    hashEvent.oldURL = 'http://localhost/doc#intro';
    hashEvent.newURL = 'http://localhost/doc#conclusion';
    win.dispatchEvent(hashEvent);

    const breadcrumbs = getBreadcrumbs();
    const hashCrumb = breadcrumbs.find((b) => b.action === 'hashchange');
    expect(hashCrumb).toBeDefined();
    expect(hashCrumb?.category).toBe('navigation.route');
    expect(hashCrumb?.data?.from).toBe('/doc#intro');
    expect(hashCrumb?.data?.to).toBe('/doc#conclusion');
  });

  it('uninstalls cleanly, restores native history methods, and stops emitting breadcrumbs', () => {
    const patchedPush = win.history.pushState;
    const patchedReplace = win.history.replaceState;

    tracker.uninstall();

    // Verify history methods restored
    expect(win.history.pushState).not.toBe(patchedPush);
    expect(win.history.replaceState).not.toBe(patchedReplace);

    // 1. pushState after uninstall produces no breadcrumbs
    win.history.pushState({}, '', '/after-teardown-push');
    expect(getBreadcrumbs().length).toBe(0);

    // 2. replaceState after uninstall produces no breadcrumbs
    win.history.replaceState({}, '', '/after-teardown-replace');
    expect(getBreadcrumbs().length).toBe(0);

    // 3. popstate event after uninstall produces no breadcrumbs
    win.location.pathname = '/after-teardown-pop';
    win.dispatchEvent(new win.Event('popstate'));
    expect(getBreadcrumbs().length).toBe(0);

    // 4. hashchange event after uninstall produces no breadcrumbs
    const hashEvt = new win.Event('hashchange') as any;
    hashEvt.oldURL = 'http://localhost/#a';
    hashEvt.newURL = 'http://localhost/#b';
    win.dispatchEvent(hashEvt);
    expect(getBreadcrumbs().length).toBe(0);
  });

  it('safely no-ops during SSR when window or history is undefined', () => {
    const ssrTracker = new NavigationTracker(client);
    expect(() => ssrTracker.install()).not.toThrow();
    expect(() => ssrTracker.uninstall()).not.toThrow();
  });
});
