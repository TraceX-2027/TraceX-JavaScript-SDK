import type React from 'react';
import type { EnvironmentContext, TraceXOptions } from '@tracex-dev/core';
import type { TraceXReactClient } from '../client/react-client';

/**
 * Browser environment context capturing client device, browser, and React runtime forensics.
 * Conforms to TraceX API Specification Section 3.1.
 */
export interface BrowserEnvironmentContext extends EnvironmentContext {
  platform?: 'browser' | string;
  runtime?: 'react' | string;
  runtime_version?: string;
  userAgent?: string;
  language?: string;
  device_pixel_ratio?: number;
  viewport_width?: number;
  viewport_height?: number;
  screen_resolution?: string;
  current_url?: string;
  is_online?: boolean;
  [key: string]: unknown;
}

/**
 * Configuration options for initializing TraceX React SDK.
 */
export interface TraceXReactOptions extends TraceXOptions {
  /**
   * Whether to capture uncaught browser errors via window.onerror and unhandledrejection.
   * Defaults to true.
   */
  instrumentErrors?: boolean;

  /**
   * Whether to capture user clicks and emit ui.tap breadcrumbs.
   * Defaults to true.
   */
  instrumentClicks?: boolean;

  /**
   * Whether to track navigation changes (pushState, replaceState, popstate, hashchange)
   * and emit navigation.route breadcrumbs.
   * Defaults to true.
   */
  instrumentNavigation?: boolean;
}

/**
 * Props passed to custom fallback render prop function.
 */
export interface FallbackProps {
  error: Error;
  componentStack?: string | null;
  eventId?: string;
  reset: () => void;
}

/**
 * Render prop function signature for error boundary fallback.
 */
export type FallbackRender = (props: FallbackProps) => React.ReactNode;

/**
 * Props accepted by TraceXErrorBoundary component.
 */
export interface TraceXErrorBoundaryProps {
  /**
   * Static React node or render-prop function to render upon component tree crash.
   */
  fallback?: React.ReactNode | FallbackRender;

  /**
   * Callback invoked whenever a child component throws an unhandled render error.
   */
  onError?: (error: Error, info: { componentStack?: string | null; eventId?: string }) => void;

  /**
   * Callback invoked when error boundary state is reset.
   */
  onReset?: () => void;

  /**
   * Array of values that, when changed across renders, automatically triggers a reset of the error state.
   */
  resetKeys?: readonly unknown[];

  /**
   * Optional custom client instance to use instead of the context or global singleton.
   */
  client?: TraceXReactClient;

  /**
   * Child component tree protected by the error boundary.
   */
  children?: React.ReactNode;
}

/**
 * Internal state for TraceXErrorBoundary.
 */
export interface TraceXErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  eventId?: string;
}
