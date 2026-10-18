import { DataScrubber } from '@tracex-dev/core';
import type { TraceXReactClient } from '../client/react-client';

/**
 * Extracts a privacy-safe CSS/attribute identifier for a clicked DOM element according to priority:
 * 1. [data-testid="..."]
 * 2. [aria-label="..."]
 * 3. #id
 * 4. tag: "sanitized inner text"
 * 5. tag.class.name
 */
export function getElementIdentifier(element: HTMLElement, scrubber?: DataScrubber): string {
  const tagName = element.tagName ? element.tagName.toLowerCase() : '';

  if (typeof element.getAttribute === 'function') {
    const testId = element.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${testId}"]`;
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return `[aria-label="${ariaLabel}"]`;
    }
  }

  if (element.id) {
    return `#${element.id}`;
  }

  let rawText = '';
  if (tagName === 'input') {
    const inputType = element.getAttribute('type')?.toLowerCase();
    if (inputType === 'submit' || inputType === 'button') {
      rawText = (element as HTMLInputElement).value || '';
    }
  } else {
    rawText = element.innerText || element.textContent || '';
  }

  const collapsedText = rawText.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (collapsedText) {
    const text = scrubber ? scrubber.scrubString(collapsedText) : collapsedText;
    return `${tagName}: "${text}"`;
  }

  const className =
    typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).join('.')
      : '';
  return tagName + (className ? `.${className}` : '');
}

/**
 * Automatically captures privacy-conscious DOM click breadcrumbs ('ui.tap').
 * Strictly ignores password inputs, emails, and elements tagged data-tracex-ignore or data-tracex-mask.
 */
export class DOMClickTracker {
  private readonly client: TraceXReactClient;
  private readonly scrubber: DataScrubber;
  private isInstalled = false;
  private readonly clickHandler: (event: MouseEvent) => void;

  constructor(client: TraceXReactClient, scrubber?: DataScrubber) {
    this.client = client;
    this.scrubber = scrubber || new DataScrubber();
    this.clickHandler = this.onClick.bind(this);
  }

  /**
   * Attaches the global capture-phase click listener.
   */
  public install(): void {
    if (typeof document === 'undefined' || this.isInstalled) {
      return;
    }

    document.addEventListener('click', this.clickHandler, true);
    this.isInstalled = true;
  }

  /**
   * Handles DOM click events and generates ui.tap breadcrumbs.
   */
  private onClick(event: MouseEvent): void {
    try {
      if (!event || !event.target) {
        return;
      }

      const target = event.target as HTMLElement;
      if (!target || typeof target.getAttribute !== 'function') {
        return;
      }

      // Check if target or any ancestor is ignored or masked
      if (
        target.hasAttribute?.('data-tracex-ignore') ||
        target.hasAttribute?.('data-tracex-mask') ||
        (typeof target.closest === 'function' && target.closest('[data-tracex-ignore], [data-tracex-mask]'))
      ) {
        return;
      }

      // Strictly suppress password and email inputs
      const isInput = target.tagName?.toLowerCase() === 'input';
      const inputType = isInput ? target.getAttribute('type')?.toLowerCase() : undefined;
      if (inputType === 'password' || inputType === 'email') {
        return;
      }

      if (
        typeof target.closest === 'function' &&
        target.closest('input[type="password"], input[type="email"]')
      ) {
        return;
      }

      // Priority targeting: prioritize closest interactive ancestor before checking child ID
      let effectiveElement = target;
      if (typeof target.closest === 'function') {
        const interactiveAncestor = target.closest<HTMLElement>(
          'button, a, [role="button"], [data-testid], [aria-label]'
        );
        if (interactiveAncestor) {
          effectiveElement = interactiveAncestor;
        }
      }

      const identifier = getElementIdentifier(effectiveElement, this.scrubber);

      // Record ui.tap breadcrumb without recording form input values
      this.client.addBreadcrumb({
        category: 'ui.tap',
        action: 'click',
        target: identifier,
      });
    } catch (err) {
      if (this.client.getOptions().debug) {
        console.warn('[TraceX] Error in DOMClickTracker click listener:', err);
      }
    }
  }

  /**
   * Unhooks click listener and cleans up.
   */
  public uninstall(): void {
    if (typeof document === 'undefined' || !this.isInstalled) {
      return;
    }

    document.removeEventListener('click', this.clickHandler, true);
    this.isInstalled = false;
  }
}
