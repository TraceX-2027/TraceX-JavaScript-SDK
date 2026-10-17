import React from 'react';
import { DataScrubber } from '@tracex/core';
import type { BrowserEnvironmentContext } from '../types';

/**
 * Isomorphic check for browser environment.
 */
export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Harvests client device, browser, and React runtime forensics.
 * Fully isomorphic and safe under Server-Side Rendering (SSR).
 */
export class BrowserEnvironmentProvider {
  private readonly scrubber: DataScrubber;

  constructor(scrubber?: DataScrubber) {
    this.scrubber = scrubber || new DataScrubber();
  }

  /**
   * Harvests current environment forensics safely.
   */
  public getEnvironmentContext(): BrowserEnvironmentContext {
    const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

    if (!inBrowser) {
      return {
        platform: 'browser',
        runtime: 'react',
        runtime_version: React.version,
      };
    }

    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const scr = typeof screen !== 'undefined' ? screen : undefined;
    const loc = typeof window !== 'undefined' ? window.location : undefined;

    return {
      platform: 'browser',
      runtime: 'react',
      runtime_version: React.version,
      userAgent: nav?.userAgent,
      language: nav?.language,
      device_pixel_ratio: typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : undefined,
      viewport_width: typeof window.innerWidth === 'number' ? window.innerWidth : undefined,
      viewport_height: typeof window.innerHeight === 'number' ? window.innerHeight : undefined,
      screen_resolution:
        scr && typeof scr.width === 'number' && typeof scr.height === 'number'
          ? `${scr.width}x${scr.height}`
          : undefined,
      current_url: loc?.href ? this.scrubber.scrubString(loc.href) : undefined,
      is_online: nav ? nav.onLine : true,
    };
  }
}
