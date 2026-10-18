import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { DOMClickTracker, getElementIdentifier } from '../src/integrations/dom-tracker';
import { TraceXReactClient } from '../src/client/react-client';
import { DataScrubber, Breadcrumb } from '@tracex-dev/core';

describe('DOMClickTracker & getElementIdentifier', () => {
  let win: GlobalWindow;
  let client: TraceXReactClient;
  let tracker: DOMClickTracker;
  let scrubber: DataScrubber;

  beforeEach(() => {
    win = new GlobalWindow({ url: 'http://localhost/' });
    Object.assign(globalThis, {
      window: win,
      document: win.document,
      navigator: win.navigator,
      location: win.location,
      HTMLElement: win.HTMLElement,
      HTMLInputElement: win.HTMLInputElement,
      MouseEvent: win.MouseEvent,
    });

    scrubber = new DataScrubber();
    client = new TraceXReactClient({
      projectKey: 'tracex_test_dom1',
      instrumentClicks: false,
      instrumentNavigation: false,
      instrumentErrors: false,
    });

    tracker = new DOMClickTracker(client, scrubber);
    tracker.install();
  });

  afterEach(async () => {
    tracker.uninstall();
    await client.close();
  });

  const getBreadcrumbs = (): Breadcrumb[] => client.getRingBuffer().getItems();

  describe('Target Identification Hierarchy', () => {
    it('prioritizes data-testid attribute over aria-label, id, and text', () => {
      const button = win.document.createElement('button');
      button.setAttribute('data-testid', 'checkout-btn');
      button.setAttribute('aria-label', 'Pay now');
      button.id = 'btn-1';
      button.textContent = 'Checkout';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].category).toBe('ui.tap');
      expect(breadcrumbs[0].action).toBe('click');
      expect(breadcrumbs[0].target).toBe('[data-testid="checkout-btn"]');
    });

    it('falls back to aria-label when data-testid is absent', () => {
      const button = win.document.createElement('button');
      button.setAttribute('aria-label', 'Close dialog');
      button.id = 'close-btn';
      button.textContent = 'X';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('[aria-label="Close dialog"]');
    });

    it('falls back to id when data-testid and aria-label are absent', () => {
      const button = win.document.createElement('button');
      button.id = 'submit-order';
      button.textContent = 'Submit';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('#submit-order');
    });

    it('falls back to sanitized inner text when attributes are absent', () => {
      const button = win.document.createElement('button');
      button.textContent = 'Sign In to Account';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('button: "Sign In to Account"');
    });

    it('falls back to tag and class name when no text or identifiers exist', () => {
      const div = win.document.createElement('div');
      div.className = 'container main-panel active';
      win.document.body.appendChild(div);

      div.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('div.container.main-panel.active');
    });

    it('identifies parent button when clicking nested child span', () => {
      const button = win.document.createElement('button');
      button.setAttribute('data-testid', 'checkout-btn');
      const span = win.document.createElement('span');
      span.textContent = 'Checkout';
      button.appendChild(span);
      win.document.body.appendChild(button);

      span.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('[data-testid="checkout-btn"]');
    });

    it('prioritizes closest interactive ancestor before checking child id', () => {
      const button = win.document.createElement('button');
      button.setAttribute('data-testid', 'action-btn');
      const spanWithId = win.document.createElement('span');
      spanWithId.id = 'nested-span-id';
      spanWithId.textContent = 'Click me';
      button.appendChild(spanWithId);
      win.document.body.appendChild(button);

      spanWithId.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('[data-testid="action-btn"]');
    });

    it('collapses interior whitespace in innerText', () => {
      const button = win.document.createElement('button');
      button.textContent = '   Click     to    confirm   order   ';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('button: "Click to confirm order"');
    });

    it('supports input[type="submit"] and input[type="button"] value as label', () => {
      const submitInput = win.document.createElement('input');
      submitInput.setAttribute('type', 'submit');
      submitInput.setAttribute('value', 'Submit Order Now');
      win.document.body.appendChild(submitInput);

      submitInput.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('input: "Submit Order Now"');
    });
  });

  describe('PII Protection & Suppression', () => {
    it('completely ignores clicks on password inputs', () => {
      const input = win.document.createElement('input');
      input.setAttribute('type', 'password');
      input.id = 'user-password';
      win.document.body.appendChild(input);

      input.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('completely ignores clicks on email inputs', () => {
      const input = win.document.createElement('input');
      input.setAttribute('type', 'email');
      input.id = 'user-email';
      win.document.body.appendChild(input);

      input.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('completely ignores elements tagged data-tracex-ignore', () => {
      const div = win.document.createElement('div');
      div.setAttribute('data-tracex-ignore', 'true');
      div.id = 'private-card';
      div.textContent = 'Secret';
      win.document.body.appendChild(div);

      div.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('completely ignores elements tagged data-tracex-mask', () => {
      const button = win.document.createElement('button');
      button.setAttribute('data-tracex-mask', '');
      button.textContent = 'Masked Action';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('completely ignores clicks on children inside data-tracex-ignore container', () => {
      const container = win.document.createElement('div');
      container.setAttribute('data-tracex-ignore', 'true');
      const button = win.document.createElement('button');
      button.textContent = 'Inside Secret';
      container.appendChild(button);
      win.document.body.appendChild(container);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('never records the input value for text input elements', () => {
      const input = win.document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('data-testid', 'search-box');
      input.value = 'super-confidential-search-query';
      win.document.body.appendChild(input);

      input.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toBe('[data-testid="search-box"]');
      // Must not leak value in breadcrumb data
      expect(breadcrumbs[0].data?.value).toBeUndefined();
      expect(JSON.stringify(breadcrumbs[0])).not.toContain('super-confidential');
    });

    it('scrubs Bearer tokens and sensitive patterns from inner text using DataScrubber', () => {
      const button = win.document.createElement('button');
      button.textContent = 'Token Bearer eyJhbGciOiJIUzI1NiJ9.test.sig';
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      const breadcrumbs = getBreadcrumbs();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).toContain('Bearer [REDACTED]');
      expect(breadcrumbs[0].target).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });
  });

  describe('Teardown & SSR Safety', () => {
    it('stops capturing clicks after uninstall()', () => {
      tracker.uninstall();

      const button = win.document.createElement('button');
      button.setAttribute('data-testid', 'btn-after-uninstall');
      win.document.body.appendChild(button);

      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

      expect(getBreadcrumbs().length).toBe(0);
    });

    it('does not throw when installed or uninstalled without DOM', () => {
      const ssrTracker = new DOMClickTracker(client);
      expect(() => ssrTracker.install()).not.toThrow();
      expect(() => ssrTracker.uninstall()).not.toThrow();
    });
  });
});
