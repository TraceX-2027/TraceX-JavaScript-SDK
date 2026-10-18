import { DataScrubber } from '@tracex-dev/core';
import type { TraceXReactClient } from '../client/react-client';

/**
 * Tracks client navigation transitions via pushState, replaceState, popstate, and hashchange.
 * Deduplicates consecutive redundant transitions and preserves native History APIs.
 */
export class NavigationTracker {
  private readonly client: TraceXReactClient;
  private readonly scrubber: DataScrubber;
  private isInstalled = false;
  private originalPushState: typeof window.history.pushState | null = null;
  private originalReplaceState: typeof window.history.replaceState | null = null;
  private lastTo?: string;
  private initialLocation?: string;

  private readonly popstateHandler: (event: PopStateEvent) => void;
  private readonly hashchangeHandler: (event: HashChangeEvent) => void;

  constructor(client: TraceXReactClient, scrubber?: DataScrubber) {
    this.client = client;
    this.scrubber = scrubber || new DataScrubber();
    this.popstateHandler = this.onPopState.bind(this);
    this.hashchangeHandler = this.onHashChange.bind(this);
  }

  /**
   * Installs history patches and navigation event listeners.
   */
  public install(): void {
    if (
      typeof window === 'undefined' ||
      typeof window.history === 'undefined' ||
      typeof window.history.pushState !== 'function' ||
      typeof window.history.replaceState !== 'function' ||
      this.isInstalled
    ) {
      return;
    }

    this.originalPushState = window.history.pushState;
    this.originalReplaceState = window.history.replaceState;
    this.initialLocation = this.getCurrentLocation();
    this.lastTo = this.initialLocation;

    const tracker = this;

    // Wrap history.pushState
    window.history.pushState = function (data: any, unused: string, url?: string | URL | null) {
      const from = tracker.getCurrentLocation();
      const result = tracker.originalPushState!.apply(this, [data, unused, url]);
      try {
        const to = url !== undefined && url !== null ? tracker.extractPath(String(url)) : tracker.getCurrentLocation();
        tracker.handleNavigation(from, to, 'pushState');
      } catch (err) {
        if (tracker.client.getOptions().debug) {
          console.warn('[TraceX] Navigation tracking error in pushState:', err);
        }
      }
      return result;
    };

    // Wrap history.replaceState
    window.history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
      const from = tracker.getCurrentLocation();
      const result = tracker.originalReplaceState!.apply(this, [data, unused, url]);
      try {
        const to = url !== undefined && url !== null ? tracker.extractPath(String(url)) : tracker.getCurrentLocation();
        tracker.handleNavigation(from, to, 'replaceState');
      } catch (err) {
        if (tracker.client.getOptions().debug) {
          console.warn('[TraceX] Navigation tracking error in replaceState:', err);
        }
      }
      return result;
    };

    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('hashchange', this.hashchangeHandler);

    this.isInstalled = true;
  }

  /**
   * Retrieves current relative URL path.
   */
  private getCurrentLocation(): string {
    if (typeof window === 'undefined' || !window.location) {
      return '/';
    }
    const path = (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    return path || '/';
  }

  /**
   * Extracts relative path from full or partial URL string.
   */
  public extractPath(urlStr: string): string {
    try {
      const base = typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/';
      const parsed = new URL(urlStr, base);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return urlStr;
    }
  }

  /**
   * Handles and deduplicates navigation transitions.
   */
  private handleNavigation(from: string, to: string, type: string): void {
    try {
      const normFrom = this.extractPath(from);
      const normTo = this.extractPath(to);

      if (normTo === this.lastTo || normFrom === normTo) {
        return;
      }

      this.lastTo = normTo;

      const scrubbedFrom = this.scrubber.scrubString(normFrom);
      const scrubbedTo = this.scrubber.scrubString(normTo);

      this.client.addBreadcrumb({
        category: 'navigation.route',
        action: type,
        target: scrubbedTo,
        data: {
          from: scrubbedFrom,
          to: scrubbedTo,
          type,
        },
      });
    } catch (err) {
      if (this.client.getOptions().debug) {
        console.warn('[TraceX] Navigation breadcrumb emission error:', err);
      }
    }
  }

  private onPopState(_event: PopStateEvent): void {
    try {
      const to = this.getCurrentLocation();
      const from = this.lastTo !== undefined ? this.lastTo : (this.initialLocation || '/');
      this.handleNavigation(from, to, 'popstate');
    } catch (err) {
      if (this.client.getOptions().debug) {
        console.warn('[TraceX] Error in onPopState:', err);
      }
    }
  }

  private onHashChange(event: HashChangeEvent): void {
    try {
      const to = event.newURL ? this.extractPath(event.newURL) : this.getCurrentLocation();
      const from = event.oldURL ? this.extractPath(event.oldURL) : (this.lastTo || this.initialLocation || this.getCurrentLocation());
      this.handleNavigation(from, to, 'hashchange');
    } catch (err) {
      if (this.client.getOptions().debug) {
        console.warn('[TraceX] Error in onHashChange:', err);
      }
    }
  }

  /**
   * Restores native history methods and unbinds event listeners.
   */
  public uninstall(): void {
    if (typeof window === 'undefined' || !this.isInstalled) {
      return;
    }

    if (window.history) {
      if (this.originalPushState) {
        window.history.pushState = this.originalPushState;
      }
      if (this.originalReplaceState) {
        window.history.replaceState = this.originalReplaceState;
      }
    }

    window.removeEventListener('popstate', this.popstateHandler);
    window.removeEventListener('hashchange', this.hashchangeHandler);

    this.originalPushState = null;
    this.originalReplaceState = null;
    this.isInstalled = false;
    this.lastTo = undefined;
    this.initialLocation = undefined;
  }
}
