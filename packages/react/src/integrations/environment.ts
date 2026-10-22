import React from 'react';
import { DataScrubber } from '@tracex-dev/core';
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
        app_version: '1.0.0',
        os_name: 'Server',
        os_version: '1.0',
        device_model: 'SSR',
        is_physical_device: false,
      };
    }

    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const scr = typeof screen !== 'undefined' ? screen : undefined;
    const loc = typeof window !== 'undefined' ? window.location : undefined;

    const userAgent = nav?.userAgent || '';
    let osName = 'Web';
    let osVersion = '1.0';
    let deviceModel = 'Browser';

    if (/Windows NT (\d+\.\d+)/.test(userAgent)) {
      osName = 'Windows';
      osVersion = RegExp.$1 === '10.0' ? '10/11' : RegExp.$1;
    } else if (/Mac OS X (\d+[._]\d+)/.test(userAgent)) {
      osName = 'macOS';
      osVersion = RegExp.$1.replace(/_/g, '.');
    } else if (/Android (\d+(\.\d+)?)/.test(userAgent)) {
      osName = 'Android';
      osVersion = RegExp.$1;
    } else if (/iPhone|iPad|iPod/.test(userAgent)) {
      osName = 'iOS';
      const match = /OS (\d+_\d+)/.exec(userAgent);
      osVersion = match ? match[1].replace(/_/g, '.') : '1.0';
    } else if (/Linux/.test(userAgent)) {
      osName = 'Linux';
      osVersion = '1.0';
    }

    if (/Edg\/(\d+)/.test(userAgent)) {
      deviceModel = `Edge ${RegExp.$1}`;
    } else if (/Chrome\/(\d+)/.test(userAgent)) {
      deviceModel = `Chrome ${RegExp.$1}`;
    } else if (/Firefox\/(\d+)/.test(userAgent)) {
      deviceModel = `Firefox ${RegExp.$1}`;
    } else if (/Safari\/(\d+)/.test(userAgent) && !/Chrome/.test(userAgent)) {
      deviceModel = `Safari ${RegExp.$1}`;
    }

    return {
      platform: 'browser',
      runtime: 'react',
      runtime_version: React.version,
      app_version: '1.0.0',
      os_name: osName,
      os_version: osVersion,
      device_model: deviceModel,
      is_physical_device: true,
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
